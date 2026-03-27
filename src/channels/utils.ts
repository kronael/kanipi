export async function sendChunked(
  text: string,
  maxLen: number,
  send: (chunk: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  let lastId: string | undefined;
  for (let i = 0; i < text.length; i += maxLen) {
    lastId = await send(text.slice(i, i + maxLen));
  }
  return lastId;
}

export function stripMention(text: string, userId: string): string {
  return text.replaceAll(`<@${userId}>`, '').trim();
}
