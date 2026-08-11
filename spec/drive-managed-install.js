(async () => {
  const ideClientPackage = lumine.packages.getActivePackage("ide-client");
  const service = ideClientPackage.mainModule.provideIdeClient();
  const result = await service.installServer("ide-marksman");
  const managed = service.managedServer("ide-marksman");
  const sessions = service.getSessions().map((session) => ({
    packageName: session.adapter.packageName,
    command: session.launch && session.launch.command,
    args: session.launch && session.launch.args,
    state: session.state,
  }));

  return { result, managed, sessions };
})();
