import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as nunjucks from "nunjucks";
import { Logger } from "../utils/Logger";

export class TemplateLoader {
  private readonly logger: Logger;
  private readonly env: nunjucks.Environment;
  private readonly templatesPath: string;

  constructor(logger: Logger, templatesPath?: string) {
    this.logger = logger;
    this.templatesPath = templatesPath || TemplateLoader.resolveTemplatesPath();

    this.env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(this.templatesPath, { noCache: true }),
      {
        autoescape: false,
        trimBlocks: true,
        lstripBlocks: true,
      },
    );

    this.env.addFilter("format", (format: string, value: unknown) => {
      if (typeof format !== "string") {
        return String(value ?? "");
      }
      const match = format.match(/%(-)?(0)?(\d+)?([sXx])/);
      if (!match) {
        return String(value ?? "");
      }
      const leftAlign = Boolean(match[1]);
      const zeroPad = Boolean(match[2]);
      const width = match[3] ? Number.parseInt(match[3], 10) : 0;
      const type = match[4];

      let rendered = "";
      if (type === "s") {
        rendered = String(value ?? "");
      } else if (type === "X" || type === "x") {
        const num = Number(value ?? 0);
        rendered = Number.isFinite(num) ? Math.trunc(num).toString(16) : "0";
        if (type === "X") {
          rendered = rendered.toUpperCase();
        }
      }

      if (width > 0 && rendered.length < width) {
        const padChar = zeroPad && !leftAlign ? "0" : " ";
        const padding = padChar.repeat(width - rendered.length);
        rendered = leftAlign
          ? `${rendered}${padding}`
          : `${padding}${rendered}`;
      }

      return rendered;
    });

    this.env.addFilter(
      "selectattr",
      (
        items: unknown,
        attribute: string,
        operator: string,
        compare: unknown,
      ) => {
        const list = Array.isArray(items) ? items : [];
        return list.filter((item) => {
          const value =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)[attribute]
              : undefined;
          if (operator === "equalto") {
            return value === compare;
          }
          if (operator === "in") {
            return Array.isArray(compare)
              ? compare.includes(value as never)
              : false;
          }
          return false;
        });
      },
    );

    this.env.addFilter("list", (items: unknown) => {
      return Array.isArray(items) ? items : [];
    });

    this.logger.info(`Template loader using ${this.templatesPath}`);
  }

  static resolveTemplatesPath(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const candidates = [path.join(__dirname, "templates")].filter(
      Boolean,
    ) as string[];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return workspaceRoot ? workspaceRoot : process.cwd();
  }

  getTemplatesPath(): string {
    return this.templatesPath;
  }

  render(templateName: string, context: Record<string, unknown>): string {
    return this.env.render(templateName, context);
  }
}
