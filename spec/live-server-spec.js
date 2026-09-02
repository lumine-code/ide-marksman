const fs = require("fs");
const os = require("os");
const path = require("path");
const main = require("../lib/main");
const { findOnPath } = require("../lib/server");
const { LiveLspClient, fileUri, positionParams } = require("./helpers/live-lsp-client");

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
    installServer: async () => {},
  });
  return { adapter, disposable };
};

// Marksman is a third-party binary rather than an npm dependency, so it is on
// PATH only where something put it there. This package's integration CI installs
// it and runs everything below for real; a fleet sweep without the third-party
// binary does not register the live-only suite.
const serverPath = process.env.MARKSMAN_PATH || findOnPath("marksman");
const liveSuite = serverPath ? describe : () => {};

liveSuite("ide-marksman official server", () => {
  let adapter, client, disposable, rootPath, indexSource, indexUri, targetUri;
  let originalTimeout;

  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-marksman");
    lumine.config.set("ide-marksman.serverPath", serverPath);
    ({ adapter, disposable } = registerAdapter());
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-marksman-live-"));
    fs.cpSync(path.join(__dirname, "fixtures", "drive"), rootPath, { recursive: true });
    indexSource = fs.readFileSync(path.join(rootPath, "index.md"), "utf8");
    indexUri = fileUri(path.join(rootPath, "index.md"));
    targetUri = fileUri(path.join(rootPath, "target.md"));
    client = new LiveLspClient(adapter, rootPath);
    await client.start();
    client.open(indexUri, indexSource);
    client.open(targetUri, fs.readFileSync(path.join(rootPath, "target.md"), "utf8"));
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    lumine.config.unset("ide-marksman.serverPath");
    await fs.promises.rm(rootPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    await lumine.packages.deactivatePackage("ide-marksman");
  });

  const indexDiagnostics = async () =>
    client.waitFor(
      () =>
        client
          .messages("textDocument/publishDiagnostics")
          .find(({ params }) => params.uri.toLowerCase().includes("/index.md"))?.params,
      "index diagnostics",
    );

  it("advertises every Marksman protocol feature and workspace route", () => {
    const capabilities = client.initializeResult.capabilities;
    expect(capabilities.textDocumentSync).toEqual({ openClose: true, change: 1 });
    expect(capabilities.completionProvider.triggerCharacters).toEqual(["[", "#", "("]);
    expect(capabilities.hoverProvider).toBe(true);
    expect(capabilities.definitionProvider).toBe(true);
    expect(capabilities.referencesProvider).toBe(true);
    expect(capabilities.documentSymbolProvider).toBe(true);
    expect(capabilities.workspaceSymbolProvider).toBe(true);
    expect(capabilities.codeActionProvider.resolveProvider).toBe(false);
    expect(capabilities.codeLensProvider).toEqual({});
    expect(capabilities.renameProvider.prepareProvider).toBe(true);
    expect(capabilities.executeCommandProvider.commands).toEqual([]);
    expect(capabilities.semanticTokensProvider.range).toBe(true);
    expect(capabilities.semanticTokensProvider.full.delta).toBe(false);
    expect(capabilities.semanticTokensProvider.legend.tokenTypes).toEqual([
      "class",
      "class",
      "enumMember",
    ]);
    expect(capabilities.workspace.workspaceFolders).toEqual({
      supported: true,
      changeNotifications: true,
    });
    expect(capabilities.workspace.fileOperations.didCreate.filters[0].pattern.glob).toBe(
      "**/*.{md,markdown}",
    );
    expect(capabilities.workspace.fileOperations.didDelete.filters[0].pattern.options).toEqual({
      ignoreCase: true,
    });
  });

  it("publishes a precise diagnostic for a missing wiki-link target", async () => {
    const diagnostics = await indexDiagnostics();
    expect(diagnostics.diagnostics.length).toBe(1);
    expect(diagnostics.diagnostics[0]).toEqual(
      jasmine.objectContaining({
        severity: 1,
        code: "2",
        source: "Marksman",
        message: "Link to non-existent document 'Missing Note'",
      }),
    );
    expect(diagnostics.diagnostics[0].range).toEqual({
      start: { line: 6, character: 24 },
      end: { line: 6, character: 40 },
    });
  });

  it("updates diagnostics after a full-document change", async () => {
    await indexDiagnostics();
    const count = client.messages("textDocument/publishDiagnostics").length;
    client.change(indexUri, indexSource.replace("[[Missing Note]]", "[[Target Note]]"));
    const diagnostics = await client.waitFor(() => {
      const messages = client.messages("textDocument/publishDiagnostics");
      return messages.length > count ? messages.at(-1).params : null;
    }, "updated diagnostics");
    expect(diagnostics.diagnostics).toEqual([]);
  });

  it("completes a partial wiki link with a server edit", async () => {
    const result = await client.request("textDocument/completion", {
      ...positionParams(indexUri, 14, 28),
      context: { triggerKind: 1 },
    });
    expect(result.isIncomplete).toBe(false);
    expect(result.items.length).toBe(1);
    expect(result.items[0]).toEqual(
      jasmine.objectContaining({
        label: "Target Note",
        kind: 18,
        detail: "target.md",
        filterText: "[[Target Note]]",
      }),
    );
    expect(result.items[0].textEdit.newText).toBe("[[target-note]]");
  });

  it("previews the complete target document on hover", async () => {
    const hover = await client.request("textDocument/hover", positionParams(indexUri, 6, 8));
    expect(hover.contents.kind).toBe("markdown");
    expect(hover.contents.value).toContain("# Target Note");
    expect(hover.contents.value).toContain("This heading has incoming links.");
  });

  it("navigates a wiki link despite Marksman's non-canonical Windows URI", async () => {
    const definition = await client.request(
      "textDocument/definition",
      positionParams(indexUri, 6, 8),
    );
    expect(definition.uri.toLowerCase()).toMatch(/target\.md$/);
    if (process.platform === "win32") expect(definition.uri.toLowerCase()).toContain("%3a");
    expect(definition.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 13 },
    });
  });

  it("finds Markdown and wiki references across the project", async () => {
    const references = await client.request("textDocument/references", {
      ...positionParams(targetUri, 0, 3),
      context: { includeDeclaration: true },
    });
    expect(references.length).toBe(4);
    expect(references.filter(({ uri }) => uri.toLowerCase().endsWith("index.md")).length).toBe(3);
    expect(references.some(({ uri }) => uri.toLowerCase().endsWith("target.md"))).toBe(true);
  });

  it("returns a hierarchical document outline", async () => {
    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri: indexUri },
    });
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("Project Notes");
    expect(symbols[0].children.map(({ name }) => name)).toEqual(["Contents", "Tasks"]);
    expect(symbols[0].selectionRange.start).toEqual({ line: 0, character: 0 });
  });

  it("searches headings across the workspace", async () => {
    const symbols = await client.request("workspace/symbol", { query: "Target" });
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("H1: Target Note");
    expect(symbols[0].location.uri.toLowerCase()).toMatch(/target\.md$/);
  });

  it("prepares and computes a cross-document heading rename", async () => {
    const prepared = await client.request(
      "textDocument/prepareRename",
      positionParams(targetUri, 0, 3),
    );
    expect(prepared).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 0, character: 13 },
    });
    const edit = await client.request("textDocument/rename", {
      ...positionParams(targetUri, 0, 3),
      newName: "Renamed Note",
    });
    expect(edit.documentChanges.length).toBe(2);
    expect(edit.documentChanges[0].edits.map(({ newText }) => newText)).toEqual([
      "renamed-note",
      "renamed-note",
    ]);
    expect(edit.documentChanges[1].edits[0].newText).toBe("Renamed Note");
  });

  it("offers table-of-contents and missing-file edits", async () => {
    const diagnostics = await indexDiagnostics();
    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri: indexUri },
      range: { start: { line: 6, character: 24 }, end: { line: 6, character: 40 } },
      context: { diagnostics: diagnostics.diagnostics },
    });
    expect(actions.map(({ title }) => title)).toEqual([
      "Create a Table of Contents",
      "Create `Missing Note.md`",
    ]);
    expect(actions[0].edit.changes[indexUri][0].newText).toContain("[Tasks](#tasks)");
    expect(actions[1].edit.documentChanges[0].kind).toBe("create");
    expect(actions[1].edit.documentChanges[0].uri).toContain("Missing%20Note.md");
  });

  it("returns reference code lenses and accepts their command", async () => {
    const lenses = await client.request("textDocument/codeLens", {
      textDocument: { uri: targetUri },
    });
    expect(lenses.map(({ command }) => command.title)).toEqual(["3 references", "2 references"]);
    expect(lenses[0].command.command).toBe("marksman.findReferences");
    expect(await client.request("workspace/executeCommand", lenses[0].command)).toBe(0);
  });

  it("classifies links through full and range semantic-token requests", async () => {
    const full = await client.request("textDocument/semanticTokens/full", {
      textDocument: { uri: indexUri },
    });
    const range = await client.request("textDocument/semanticTokens/range", {
      textDocument: { uri: indexUri },
      range: { start: { line: 6, character: 0 }, end: { line: 9, character: 0 } },
    });
    expect(full.data.length).toBe(15);
    expect(full.data.length % 5).toBe(0);
    expect(range.data.length).toBe(10);
    expect(range.data.length % 5).toBe(0);
  });

  it("indexes files announced through workspace file operations", async () => {
    const freshPath = path.join(rootPath, "fresh.md");
    const freshUri = fileUri(freshPath);
    fs.writeFileSync(freshPath, "# Fresh Document\n");
    client.notify("workspace/didCreateFiles", { files: [{ uri: freshUri }] });
    const created = await client.waitFor(async () => {
      const symbols = await client.request("workspace/symbol", { query: "Fresh" });
      return symbols.length ? symbols : null;
    }, "created file symbol");
    expect(created[0].name).toBe("H1: Fresh Document");

    fs.rmSync(freshPath);
    client.notify("workspace/didDeleteFiles", { files: [{ uri: freshUri }] });
    await client.waitFor(async () => {
      const symbols = await client.request("workspace/symbol", { query: "Fresh" });
      return symbols.length === 0;
    }, "deleted file removal");
  });

  it("adopts and removes another workspace folder", async () => {
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ide-marksman-folder-"));
    const secondUri = fileUri(secondRoot);
    try {
      fs.writeFileSync(path.join(secondRoot, ".marksman.toml"), "");
      fs.writeFileSync(path.join(secondRoot, "secondary.md"), "# Secondary Workspace\n");
      client.notify("workspace/didChangeWorkspaceFolders", {
        event: {
          added: [{ uri: secondUri, name: path.basename(secondRoot) }],
          removed: [],
        },
      });
      const added = await client.waitFor(async () => {
        const symbols = await client.request("workspace/symbol", { query: "Secondary" });
        return symbols.length ? symbols : null;
      }, "added workspace folder");
      expect(added[0].name).toBe("H1: Secondary Workspace");

      client.notify("workspace/didChangeWorkspaceFolders", {
        event: {
          added: [],
          removed: [{ uri: secondUri, name: path.basename(secondRoot) }],
        },
      });
      await client.waitFor(async () => {
        const symbols = await client.request("workspace/symbol", { query: "Secondary" });
        return symbols.length === 0;
      }, "removed workspace folder");
    } finally {
      fs.rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  it("closes a document and shuts down without server errors", async () => {
    client.close(indexUri);
    client.close(targetUri);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.stderr).not.toContain("ERR");
    expect(client.child.exitCode).toBeNull();
  });
});
