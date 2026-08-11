const { CompositeDisposable } = require("lumine");
const { managedServer, resolveServer } = require("./server");

let missingReported = false;

const setting = (key) => lumine.config.get(`ide-marksman.${key}`);

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-marksman",
      displayName: "Marksman Language Server",
      grammarScopes: ["source.gfm"],
      languageId: "markdown",
      sessionScope: "project-root",
      managedServer,
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), context.managedServer);
        if (!launch) {
          if (!missingReported) {
            missingReported = true;
            lumine.notifications.addError("Unable to find Marksman", {
              description:
                "Install [Marksman](https://github.com/artempyanykh/marksman) and make sure it is on your PATH, or set its location in the ide-marksman settings. The editor can also fetch it for you.",
              dismissable: true,
              buttons: [
                {
                  text: "Install Marksman",
                  onDidClick: () => service.installServer("ide-marksman").catch(() => {}),
                },
              ],
            });
          }
          return null;
        }
        missingReported = false;
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
    };

    const subscriptions = new CompositeDisposable(service.registerAdapter(adapter));
    subscriptions.add(
      lumine.config.onDidChange("ide-marksman.serverPath", () => {
        for (const session of service.getSessions()) {
          if (session.adapter !== adapter || ["stopping", "stopped"].includes(session.state))
            continue;
          service.restart(session).catch((error) => {
            lumine.notifications.addError("Unable to restart Marksman Language Server", {
              detail: error.message,
              dismissable: true,
            });
          });
        }
      }),
    );
    return subscriptions;
  },
};
