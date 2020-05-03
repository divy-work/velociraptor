import { isWindows } from "../deps.ts";
import { log } from "./logger.ts";
import {
  FlagsObject,
  EnvironmentVariables,
  ScriptOptions,
} from "./scripts_config.ts";
import {
  ParallelCommands,
  Command,
  isParallel,
} from "./command.ts";

const denoCmdOptions: { [key: string]: string[] } = {
  bundle: ["cert", "imap", "log"],
  cache: ["cert", "tsconfig", "imap", "lock", "log"],
  install: ["allow", "log"],
  run: [
    "allow",
    "cert",
    "tsconfig",
    "imap",
    "inspect",
    "inspectBrk",
    "lock",
    "log",
    "v8Flags",
  ],
  test: [
    "allow",
    "cert",
    "tsconfig",
    "imap",
    "inspect",
    "inspectBrk",
    "lock",
    "log",
    "v8Flags",
  ],
};

const denoOption: { [key: string]: string } = {
  allow: "allow-",
  cert: "cert",
  imap: "importmap",
  inspect: "inspect",
  inspectBrk: "inspect-brk",
  lock: "lock",
  log: "log-level",
  tsconfig: "config",
  v8Flags: "v8-flags",
};

export async function runCommands(
  commands: Array<Command | ParallelCommands | null>,
  shell: string,
  additionalArgs: string[],
  cwd: string,
): Promise<void> {
  if (!commands) return;
  const runCommandsR = async (
    commands:
      | Command
      | ParallelCommands
      | Array<
        Command | ParallelCommands
      >,
  ): Promise<unknown> => {
    if (Array.isArray(commands)) {
      for (let command of commands) {
        await runCommandsR(command);
      }
    } else {
      if (isParallel(commands)) {
        return Promise.all(commands.pll.map((c) => runCommandsR(c)));
      }
      return runCommand(commands, shell, additionalArgs, cwd);
    }
  };
  await runCommandsR(commands as Array<Command | ParallelCommands>);
}

function insertOptions(
  command: string,
  atPosition: number,
  ...options: string[]
) {
  return command.slice(0, atPosition) + " " + options.join(" ") +
    command.slice(atPosition);
}

function generateFlagOptions(
  flags: FlagsObject,
  prefix: string = "",
): string[] {
  return Object.entries(flags).map(([k, v]) =>
    `--${prefix}${k}${v !== true ? `="${v}"` : ""}`
  );
}

async function runCommand(
  command: Command,
  shell: string,
  additionalArgs: string[],
  cwd: string,
): Promise<void> {
  let cmd = command.cmd, match;
  if (match = matchCompactRun(cmd)) {
    cmd = "deno run " + cmd;
  }
  if (match = matchDenoCommand(cmd)) {
    const subCommand = match[1];
    if (subCommand && subCommand in denoCmdOptions) {
      const insertAt = match[0].length;
      const options = denoCmdOptions[subCommand];
      for (let optionName of options) {
        const option = command[optionName as keyof ScriptOptions];
        if (option) {
          if (optionName === "allow") {
            const flags = generateFlagOptions(
              option as FlagsObject,
              denoOption[optionName],
            );
            if (flags && flags.length > 0) {
              cmd = insertOptions(cmd, insertAt, ...flags);
            }
          } else if (optionName === "v8Flags") {
            const flags = generateFlagOptions(option as FlagsObject);
            if (flags && flags.length > 0) {
              cmd = insertOptions(
                cmd,
                insertAt,
                `--${denoOption[optionName]}=${flags.join(",")}`,
              );
            }
          } else {
            cmd = insertOptions(
              cmd,
              insertAt,
              `--${denoOption[optionName]}=${option}`,
            );
          }
        }
      }
    }
  }
  let runOptions: Deno.RunOptions = {
    cmd: [shell, ...buildShellArgs(shell, cmd), shell, ...additionalArgs],
    cwd,
  };
  if (command.env && Object.entries(command.env).length > 0) {
    runOptions.env = stringifyEnv(command.env);
  }
  log.debug(
    `> ${cmd}${
      additionalArgs && additionalArgs.length > 0
        ? ` -- ${additionalArgs.join(" ")}`
        : ""
    }`,
  );
  const process = Deno.run(runOptions);
  const status = await process.status();
  if (status.code !== 0) {
    throw new Error(`Command returned error code ${status.code}`);
  }
  process.close();
}

function matchDenoCommand(command: string) {
  return command.match(/^deno +(\w+)/);
}

function matchCompactRun(command: string) {
  return command.match(
    /^'(?:\\'|.)*?\.ts'|^"(?:\\"|.)*?\.ts"|^(?:\\\ |\S)+\.ts/,
  );
}

function stringifyEnv(env: EnvironmentVariables): EnvironmentVariables {
  for (let key in env) {
    if (key in env) {
      env[key] = String(env[key]);
    }
  }
  return env;
}

function buildShellArgs(shell: string, command: string): string[] {
  if (isWindows && /^(?:.*\\)?cmd(?:\.exe)?$/i.test(shell)) {
    return ["/d", "/s", "/c", command];
  }
  return ["-c", command];
}
