const fs = require("fs");
const path = require("path");
const manifest = require("../package.json");

describe("ide-marksman package assets", () => {
  const root = path.join(__dirname, "..");

  it("keeps the canonical description synchronized", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    expect(readme.split(/\r?\n/)[2]).toBe(manifest.description);
    expect(manifest.description).toBe("Marksman language-server adapter for Markdown.");
  });

  it("ships its implementation and specs", () => {
    expect(manifest.files).toEqual(["lib", "spec"]);
    expect(manifest.scripts.test).toBe("lumine --test spec");
  });

  it("pins the live CI fixture to an official Marksman release", () => {
    const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("MARKSMAN_VERSION: 2026-02-08");
    expect(workflow).toContain("marksman-linux-x64");
    expect(workflow).toContain("--test ../ide-marksman/spec");
  });
});
