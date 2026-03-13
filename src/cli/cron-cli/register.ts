import type { Command } from "commander";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import {
  registerCronAddCommand,
  registerCronListCommand,
  registerCronStatusCommand,
} from "./register.cron-add.js";
import { registerCronEditCommand } from "./register.cron-edit.js";
import { registerCronSimpleCommands } from "./register.cron-simple.js";

export function registerCronCli(program: Command) {
  const cron = program
    .command("cron")
    .description("Manage cron jobs (via Gateway)")
    .addHelpText(
      "after",
      () =>
<<<<<<< HEAD
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/cron", "nicholsbot-docs.vercel.app/cli/cron")}\n`,
=======
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/cron", "docs.openclaw.ai/cli/cron")}\n${theme.muted("Upgrade tip:")} run \`openclaw doctor --fix\` to normalize legacy cron job storage.\n`,
>>>>>>> sync/upstream-20260313
    );

  registerCronStatusCommand(cron);
  registerCronListCommand(cron);
  registerCronAddCommand(cron);
  registerCronSimpleCommands(cron);
  registerCronEditCommand(cron);
}
