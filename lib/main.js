const { managedServer, resolveServer } = require("./server");

const setting = (key) => lumine.config.get(`ide-marksman.${key}`);

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-marksman",
      displayName: "Marksman Language Server",
      grammarScopes: ["source.gfm"],
      languageId: "markdown",
      sessionScope: "project-root",
      restartKeyPaths: ["ide-marksman.serverPath"],
      managedServer,
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), context.managedServer);
        if (!launch) {
          // The hub owns the wording, the once-per-window dedupe, the Install
          // button and the opt-out, so every adapter says this the same way.
          service.reportMissingServer("ide-marksman", {
            description:
              "Install [Marksman](https://github.com/artempyanykh/marksman) and make sure it is on your PATH, or set its location in the ide-marksman settings. The editor can also fetch it for you.",
          });
          return null;
        }
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
    };

    return service.registerAdapter(adapter);
  },
};
