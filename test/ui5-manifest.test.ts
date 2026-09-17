import { describe, expect, test } from "bun:test";

// UI API 5 hosts reject executable UI4 artifacts. This assertion reads the
// generated manifest (building it first when missing) so a UI4 regression
// fails the suite instead of shipping a silently dropped monitor panel.
describe("Plugin UI API 5 artifact", () => {
  test("ships a UI5 artifact declaration in the built manifest", async () => {
    const manifestPath = `${import.meta.dir}/../dist/plugin.json`;
    if (!(await Bun.file(manifestPath).exists())) {
      const build = Bun.spawn([process.execPath, "run", "build"], {
        cwd: `${import.meta.dir}/..`,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [buildExit, buildStderr] = await Promise.all([
        build.exited,
        new Response(build.stderr).text(),
      ]);
      if (buildExit !== 0) throw new Error(buildStderr);
    }
    const manifest = await Bun.file(manifestPath).json();
    expect(manifest.artifacts.ui.apiVersion).toBe("5.0");
    expect(manifest.artifacts.ui.entry).toBe("ui/index.js");
    const stylesheet = manifest.artifacts.ui.resources.find(
      (resource: { entry: string; kind?: string }) => resource.entry === "ui/index.css",
    );
    expect(stylesheet).toMatchObject({ kind: "stylesheet" });
    expect(manifest.compatibility.synergy).toBe(">=3.0.23");
  });
});
