import { expect } from "chai";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

import { ChildProcess, execFile } from "child_process";
import { version } from "df/core/version";
import { suite, test } from "df/testing";

suite(__filename, () => {
  const platformPath = os.platform() === "darwin" ? "nodejs_darwin_amd64" : "nodejs_linux_amd64";
  const nodePath = `external/${platformPath}/bin/node`;
  const npmPath = `external/${platformPath}/bin/npm`;
  const corePackageTarPath = "packages/@dataform/core/package.tgz";
  const cliEntryPointPath = "tests/cli/node_modules/@dataform/cli/bundle.js";

  const projectDir = path.join(process.env.TEST_TMPDIR, "project");
  const npmCacheDir = path.join(process.env.TEST_TMPDIR, "npm-cache");

  test("init and compile", async () => {
    // Initialize a project using the CLI, don't install packages.
    await getProcessResult(
      execFile(nodePath, [
        cliEntryPointPath,
        "init",
        "bigquery",
        projectDir,
        "--skip-install",
        "--default-database",
        "dataform-integration-tests"
      ])
    );

    // Install packages manually to get around bazel sandbox issues.
    await getProcessResult(
      execFile(npmPath, [
        "install",
        "--prefix",
        projectDir,
        "--cache",
        npmCacheDir,
        corePackageTarPath
      ])
    );

    // Write a simple file to the project.
    const filePath = path.join(projectDir, "definitions", "example.sqlx");
    fs.ensureFileSync(filePath);
    fs.writeFileSync(
      filePath,
      `
config { type: "table" }
select 1 as test
`
    );

    // Compile the project using the CLI.
    const compileResult = await getProcessResult(
      execFile(nodePath, [cliEntryPointPath, "compile", projectDir, "--json"])
    );

    expect(compileResult.exitCode).equals(0);

    expect(JSON.parse(compileResult.stdout)).deep.equals({
      tables: [
        {
          name: "dataform-integration-tests.dataform.example",
          type: "table",
          target: {
            database: "dataform-integration-tests",
            schema: "dataform",
            name: "example"
          },
          canonicalTarget: {
            schema: "dataform",
            name: "example",
            database: "dataform-integration-tests"
          },
          query: "\n\nselect 1 as test\n",
          disabled: false,
          fileName: "definitions/example.sqlx"
        }
      ],
      projectConfig: {
        warehouse: "bigquery",
        defaultSchema: "dataform",
        assertionSchema: "dataform_assertions",
        defaultDatabase: "dataform-integration-tests",
        useRunCache: false
      },
      graphErrors: {},
      dataformCoreVersion: version,
      targets: [
        {
          database: "dataform-integration-tests",
          schema: "dataform",
          name: "example"
        }
      ]
    });

    // Dry run the project.
    const runResult = await getProcessResult(
      execFile(nodePath, [
        cliEntryPointPath,
        "run",
        projectDir,
        "--credentials",
        "test_credentials/bigquery.json",
        "--dry-run",
        "--json"
      ])
    );

    expect(runResult.exitCode).equals(0);

    expect(JSON.parse(runResult.stdout)).deep.equals({
      actions: [
        {
          fileName: "definitions/example.sqlx",
          hermeticity: "HERMETIC",
          name: "dataform-integration-tests.dataform.example",
          tableType: "table",
          target: {
            database: "dataform-integration-tests",
            name: "example",
            schema: "dataform"
          },
          tasks: [
            {
              statement:
                "create or replace table `dataform-integration-tests.dataform.example` as \n\nselect 1 as test",
              type: "statement"
            }
          ],
          type: "table"
        }
      ],
      projectConfig: {
        assertionSchema: "dataform_assertions",
        defaultDatabase: "dataform-integration-tests",
        defaultSchema: "dataform",
        useRunCache: false,
        warehouse: "bigquery"
      },
      runConfig: {
        fullRefresh: false,
        useRunCache: false
      },
      warehouseState: {}
    });
  });
});

async function getProcessResult(childProcess: ChildProcess) {
  let stdout = "";
  childProcess.stderr.pipe(process.stderr);
  childProcess.stdout.pipe(process.stdout);
  childProcess.stdout.on("data", chunk => (stdout += String(chunk)));
  const exitCode: number = await new Promise(resolve => {
    childProcess.on("close", resolve);
  });
  return { exitCode, stdout };
}
