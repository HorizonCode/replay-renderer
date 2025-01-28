import Enquirer from "enquirer";
import { existsSync, mkdirSync } from "fs";
import { readdir, writeFile } from "fs/promises";
import { join } from "path";
import * as cliProgress from "cli-progress";
import { ScoreDecoder } from "osu-parsers";
import { spawn } from "child_process";

const danserExecuteable = join(
  __dirname,
  process.platform == "win32" ? "bin-win" : "bin",
  process.platform == "win32" ? "danser-cli.exe" : "danser-cli"
);
const replaysFolder = join(__dirname, "data", "replays");
const songsFolder = join(__dirname, "data", "songs");
const exportFolder = join(__dirname, "data", "export");

if (!existsSync(replaysFolder)) mkdirSync(replaysFolder);
if (!existsSync(songsFolder)) mkdirSync(songsFolder);
if (!existsSync(exportFolder)) mkdirSync(exportFolder);

(async () => {
  if (process.platform !== "win32" && process.platform !== "linux") {
    console.log(`The platform ${process.platform} is not compatible.`);
    return;
  }
  const skins = await readdir("data/skins");
  console.log(skins);
  const options = (await Enquirer.prompt([
    {
      type: "numeral",
      name: "replayId",
      message: "Enter the replay ID",
    },
    {
      type: "select",
      name: "skin",
      message: "Select a skin",
      choices: skins,
    },
  ])) as {
    replayId: string;
    skin: string;
  };

  const replayId = options.replayId;
  const skin = options.skin;

  console.log("Downloading replay...");
  const replayDownload = await fetch(
    `https://api.ez-pp.farm/v1/get_replay?id=${replayId}`
  );
  if (!replayDownload.ok) {
    console.log("Failed to download replay.");
    return;
  }
  const replayArray = await replayDownload.arrayBuffer();
  const replayFile = join(replaysFolder, `${replayId}.osr`);
  await writeFile(replayFile, Buffer.from(replayArray));
  console.log("replay saved!");
  console.log("Parsing replay...");
  const scoreDecoder = new ScoreDecoder();
  const parsedScore = await scoreDecoder.decodeFromPath(replayFile, false);
  console.log("replay parsed!");
  const beatmapHash = parsedScore.info.beatmapHashMD5;
  console.log("Getting BeatmapSet info...");
  const beatmapDataRequest = await fetch(
    `https://osu.direct/api/v2/md5/${beatmapHash}`
  );
  if (!beatmapDataRequest.ok) {
    console.log(
      "Failed to get beatmapset info.",
      beatmapDataRequest.status,
      `https://osu.direct/api/v2/md5/${beatmapHash}`
    );
    return;
  }
  const beatmapData = await beatmapDataRequest.json();
  console.log("got beatmapset info!");
  const beatmapSetId = beatmapData.beatmapset_id;
  console.log("Downloading BeatmapSet...");
  const beatmapSetDownloadRequest = await fetch(
    `https://osu.direct/api/d/${beatmapSetId}?noVideo`
  );
  if (!beatmapSetDownloadRequest.ok) {
    console.log(
      "Failed to download beatmapset.",
      beatmapSetDownloadRequest.status
    );
    return;
  }
  const beatmapSetArray = await beatmapSetDownloadRequest.arrayBuffer();
  const setFile = join(songsFolder, `${beatmapSetId}.osz`);
  await writeFile(setFile, Buffer.from(beatmapSetArray));
  console.log("BeatmapSet saved!");
  console.log("rendering replay...\n");
  const progress = new cliProgress.SingleBar({
    barCompleteChar: "+",
    barIncompleteChar: "-",
    format: "[{bar}] {percentage}% | ETA: {eta}s",
  });
  progress.start(100, 0);
  const danserProcess = spawn(danserExecuteable, [
    `-skin=${skin}`,
    `-out=${replayId}`,
    `-md5=${beatmapHash}`,
    `-r=${replayFile}`,
    `-preciseprogress`,
  ]);
  danserProcess.stdout.on("data", function (data) {
    const line: string = data.toString().trim();
    if (line.includes("Progress")) {
      const percentage = line.match(/(\d+)%/g);
      if (percentage) {
        const percentageInt = parseInt(
          percentage[0].substring(0, percentage[0].length - 1)
        );
        progress.update(percentageInt);
      }
    }
  });

  danserProcess.on("exit", function (code) {
    if (code)
      console.log("\n\nchild process exited with code " + code.toString());
    else console.log("\n\nreplay rendered!");

    progress.stop();
  });
})();
