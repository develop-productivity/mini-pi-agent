import { type Static, type TSchema, Type } from "typebox";
import { tools, type Tool} from "./builtin.ts"

export const toolsByName: Record<string, Tool<TSchema>> = Object.fromEntries(
    tools.map((tool) => [tool.name, tool]),
);

export function registerTool(tool: Tool) : void {
    tools.push(tool)
    toolsByName[tool.name] = tool
}

export function getTool(name: string): Tool | undefined {
    return toolsByName[name];
}
