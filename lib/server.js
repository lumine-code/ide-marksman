const ASSETS = {
  "win32-x64": "marksman.exe",
  "darwin-x64": "marksman-macos",
  "darwin-arm64": "marksman-macos",
  "linux-x64": "marksman-linux-x64",
  "linux-arm64": "marksman-linux-arm64",
};

exports.assetFor = ({ platform, arch }) => ASSETS[`${platform}-${arch}`] || null;

exports.managedServer = {
  source: "github-release",
  displayName: "Marksman",
  repository: "artempyanykh/marksman",
  assetFor: exports.assetFor,
  assetType: "binary",
  // Marksman publishes raw executables but no checksum sidecars. Keeping this
  // explicit prevents the installer from silently implying verification.
  checksum: "none",
  binary: process.platform === "win32" ? "marksman.exe" : "marksman",
};

exports.resolveServer = async (context, configuredPath = "") => {
  const selection = await context.resolver.select({
    kind: "executable",
    configuredPath,
    managedPath: context.managedServer?.binaryPath,
    managedVersion: context.managedServer?.version,
    env: context.env,
    cwd: context.rootPath,
    names: ["marksman"],
    signal: context.signal,
  });
  return selection
    ? context.resolver.launch(selection, { signal: context.signal, args: ["server"] })
    : null;
};
