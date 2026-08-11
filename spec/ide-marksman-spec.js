const path = require("path");
const main = require("../lib/main");
const { assetFor, findOnPath, managedServer, resolveServer } = require("../lib/server");

const FEATURES = [
  "diagnostics",
  "autocomplete",
  "hover",
  "definition",
  "references",
  "symbols",
  "outline",
  "rename",
  "codeActions",
  "codeLens",
  "semanticTokens",
];

const registerAdapter = (overrides = {}) => {
  let adapter;
  const service = {
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
    installServer: async () => {},
    ...overrides,
  };
  const disposable = main.consumeIdeClient(service);
  return { adapter, disposable, service };
};

describe("ide-marksman server resolution", () => {
  it("launches a configured executable with the server subcommand", async () => {
    expect(await resolveServer(process.execPath)).toEqual({
      command: process.execPath,
      args: ["server"],
    });
  });

  it("prefers a managed install and preserves its version", async () => {
    const managed = { binaryPath: "/managed/marksman", version: "2026-02-08" };
    expect(await resolveServer("", managed)).toEqual({
      command: "/managed/marksman",
      args: ["server"],
      version: "2026-02-08",
    });
    expect((await resolveServer(process.execPath, managed)).command).toBe(process.execPath);
  });

  it("finds executables on a synthetic PATH", () => {
    const directory = path.dirname(process.execPath);
    const name = path.basename(process.execPath, path.extname(process.execPath));
    expect(findOnPath(name, { PATH: directory, PATHEXT: ".EXE" })).toBeTruthy();
    expect(findOnPath("definitely-not-marksman", { PATH: directory })).toBeNull();
  });

  it("maps every official release target exactly", () => {
    expect(assetFor({ platform: "win32", arch: "x64" })).toBe("marksman.exe");
    expect(assetFor({ platform: "darwin", arch: "x64" })).toBe("marksman-macos");
    expect(assetFor({ platform: "darwin", arch: "arm64" })).toBe("marksman-macos");
    expect(assetFor({ platform: "linux", arch: "x64" })).toBe("marksman-linux-x64");
    expect(assetFor({ platform: "linux", arch: "arm64" })).toBe("marksman-linux-arm64");
    expect(assetFor({ platform: "win32", arch: "arm64" })).toBeNull();
    expect(assetFor({ platform: "freebsd", arch: "x64" })).toBeNull();
  });

  it("declares the raw official release as its managed server", () => {
    expect(managedServer.source).toBe("github-release");
    expect(managedServer.repository).toBe("artempyanykh/marksman");
    expect(managedServer.assetType).toBe("binary");
    expect(managedServer.checksum).toBe("none");
    expect(managedServer.binary).toBe(process.platform === "win32" ? "marksman.exe" : "marksman");
  });
});

describe("ide-marksman adapter", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-marksman");
    ({ adapter, disposable } = registerAdapter());
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-marksman");
  });

  it("registers Markdown as a project-scoped managed server", () => {
    expect(adapter.id).toBe("ide-marksman");
    expect(adapter.displayName).toBe("Marksman Language Server");
    expect(adapter.grammarScopes).toEqual(["source.gfm"]);
    expect(adapter.languageId).toBe("markdown");
    expect(adapter.sessionScope).toBe("project-root");
    expect(adapter.managedServer).toBe(managedServer);
  });

  it("adds the project working directory and stdio transport", async () => {
    const launch = await adapter.resolveServer({
      rootPath: __dirname,
      managedServer: { binaryPath: process.execPath, version: "test" },
    });
    expect(launch).toEqual({
      command: process.execPath,
      args: ["server"],
      version: "test",
      cwd: __dirname,
      transport: "stdio",
    });
  });

  it("restarts only its live sessions when the executable changes", async () => {
    disposable.dispose();
    const live = { adapter: null, state: "running" };
    const stopped = { adapter: null, state: "stopped" };
    const other = { adapter: {}, state: "running" };
    const restart = jasmine.createSpy("restart").and.returnValue(Promise.resolve());
    ({ adapter, disposable } = registerAdapter({
      getSessions: () => [live, stopped, other],
      restart,
    }));
    live.adapter = adapter;
    stopped.adapter = adapter;

    lumine.config.set("ide-marksman.serverPath", process.execPath);
    await Promise.resolve();

    expect(restart).toHaveBeenCalledOnceWith(live);
  });

  it("offers the managed install when no executable can be found", async () => {
    const originalPath = process.env.PATH;
    const addError = spyOn(lumine.notifications, "addError");
    const installServer = jasmine.createSpy("installServer").and.returnValue(Promise.resolve());
    disposable.dispose();
    ({ adapter, disposable } = registerAdapter({ installServer }));
    try {
      process.env.PATH = "";
      expect(await adapter.resolveServer({ rootPath: __dirname, managedServer: null })).toBeNull();
      expect(addError).toHaveBeenCalled();
      const options = addError.calls.mostRecent().args[1];
      expect(options.buttons[0].text).toBe("Install Marksman");
      options.buttons[0].onDidClick();
      await Promise.resolve();
      expect(installServer).toHaveBeenCalledOnceWith("ide-marksman");
    } finally {
      process.env.PATH = originalPath;
      await adapter.resolveServer({
        rootPath: __dirname,
        managedServer: { binaryPath: process.execPath, version: "test" },
      });
    }
  });

  it("declares switches for exactly the features Marksman advertises", () => {
    expect(Object.keys(require("../package.json").configSchema.features.properties)).toEqual(
      FEATURES,
    );
  });
});

describe("ide-marksman feature contracts", () => {
  const definitions = require("../package.json").configSchema.features.properties;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-marksman");
  });

  afterEach(async () => {
    for (const feature of FEATURES) lumine.config.unset(`ide-marksman.features.${feature}`);
    await lumine.packages.deactivatePackage("ide-marksman");
  });

  for (const feature of FEATURES) {
    it(`exposes ${feature} as an independent enabled-by-default switch`, () => {
      expect(definitions[feature].type).toBe("boolean");
      expect(definitions[feature].default).toBe(true);
      const keyPath = `ide-marksman.features.${feature}`;
      expect(lumine.config.get(keyPath)).toBe(true);
      lumine.config.set(keyPath, false);
      expect(lumine.config.get(keyPath)).toBe(false);
    });
  }
});
