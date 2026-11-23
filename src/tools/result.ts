export type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

export function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs a handler body and turns any thrown error into an error result. */
export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(errorText(err));
  }
}
