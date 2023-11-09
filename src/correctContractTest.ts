const fileUtils = require("./fileUtils");
const util = require("node:util") as typeof import("node:util");
const exec = util.promisify(
  (require("node:child_process") as typeof import("node:child_process")).exec
);
const dotenv = require("dotenv");
const path = require("path") as typeof import("path");
const os = require("os");
const axios = require("axios").default;
const readline = require("readline/promises");
const temp = require("./tempDemo");
const ws = require("ws");

const DEFAULT_ITERATION_TIME = 3;
const DEBUGGER_ENDPOINT_URL =
  "wss://70zxlqo8jd.execute-api.us-east-1.amazonaws.com/prod/";

async function correctContractTest(
  githubUrl: string,
  runCommand: string,
  testFilePath: string
) {
  dotenv.config({ path: path.resolve(os.homedir() + "/.mutableai") });
  if (!process.env.ACCESS_TOKEN) {
    throw new Error(
      "Access token is not configured. Please go on webapp to authenticate"
    );
  }
  let testRunSuccessfully = false;
  let iteration = 0;
  while (iteration < DEFAULT_ITERATION_TIME && !testRunSuccessfully) {
    let fileContent = "";
    try {
      fileContent = await fileUtils.readFile(testFilePath, "utf-8");
    } catch (error) {
      console.error("Error reading file:", error);
      return;
    }
    console.log(`running command: ${runCommand}`);
    let feedback = "";
    let output;
    try {
      output = await exec(runCommand);
      feedback = output.stdout;
    } catch (error) {
      feedback = error as string;
    }
    console.log(feedback);
    const wantToProceed = await askToProceed();
    if (wantToProceed) {
      const newFileContent = await correctTest(
        process.env.ACCESS_TOKEN,
        "main",
        githubUrl,
        testFilePath,
        fileContent,
        feedback
      );
      console.log("Fix suggested by AI:");
      console.log(newFileContent);
      const wantToModifyFile = await askToModifyFile();
      if (wantToModifyFile) {
        fileUtils.modifyFile(testFilePath, newFileContent);
      }
    } else {
      console.log("User chose not to proceed.");
      return;
    }
    iteration++;
  }
}

async function correctTest(
  accessToken: string,
  branch: string,
  repoUrl: string,
  filePath: string,
  fileContent: string,
  stdout: string
): Promise<string> {
  const wsPromise: Promise<string> = new Promise((resolve, reject) => {
    const wsClient = new ws.WebSocket(DEBUGGER_ENDPOINT_URL, [
      process.env.WSS_API_KEY!,
    ]);

    const source_code_dict: { [key: string]: string } = {};
    source_code_dict[filePath] = fileContent;
    const reqMsg = {
      repo_url: repoUrl,
      branch: branch,
      access_token: accessToken,
      debug_type: "contract_test",
      console_output: stdout,
      source_code: source_code_dict,
    };
    let debugOutput = "";
    wsClient.onopen = () => {
      console.log("starts generating fix");
      wsClient.send(JSON.stringify(reqMsg));
    };
    wsClient.onmessage = async (event: any) => {
      let message = event.data;
      try {
        if (typeof message == "object") {
          // The message is a Blob
          message = await message.text();
        }
        const parsedMessage = JSON.parse(message);
        if (parsedMessage.type === "debug_output") {
          process.stdout.write(parsedMessage.data.content);
          debugOutput += parsedMessage.data.content;
        }
        if (parsedMessage.type === "termination") {
          console.log("");
          console.log(`[${parsedMessage.request_id}] Finished generating fix`);
          resolve(debugOutput);
        }
      } catch (e) {
        console.log(`can't parse message: ${e}. The message is ${message}`);
      }
    };
    wsClient.onclose = () => {
      console.log("ws closed");
      resolve("");
    };
    wsClient.onerror = (error: any) => {
      console.log("ws errored");
      reject();
    };
  });

  return wsPromise;
}

// async function correctTestDemo(
//   accessToken: string,
//   branch: string,
//   repoUrl: string,
//   filePath: string,
//   fileContent: string,
//   stdout: string
// ): Promise<string> {
//   await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
//   return temp.correct_source_code;
// }

async function askToProceed() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      "Do you want to proceed with fixing the test Y/N "
    );
    const wantToProceed = answer.trim() === "Y" || answer.trim() === "y";
    return wantToProceed;
  } catch (err) {
    rl.close();
    console.log(`Error: `, err);
    return false;
  }
}

async function askToModifyFile() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      "Do you want to accept the change proposed by AI Y/N "
    );
    const wantToProceed = answer.trim() === "Y" || answer.trim() === "y";
    return wantToProceed;
  } catch (err) {
    rl.close();
    console.log(`Error: `, err);
    return false;
  }
}

export {};
exports.correctContractTest = correctContractTest;
