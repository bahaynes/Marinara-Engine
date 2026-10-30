/**
 * Which chats may use a generated background. A generated background records the chat it was made for
 * (`chatId` in backgrounds/meta.json); it belongs to that chat's story, not just the one chat: a game's
 * sessions and a chat's branches share a groupId, and a scene chat records its origin chat. Backgrounds
 * without an owner are the shared library.
 */
interface StoryChat {
  id: string;
  groupId?: string | null;
  metadata?: unknown;
}

type GetChat = (id: string) => Promise<StoryChat | null | undefined>;

function sceneOriginChatId(chat: StoryChat): string | null {
  let metadata = chat.metadata;
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  const origin = (metadata as { sceneOriginChatId?: unknown } | null)?.sceneOriginChatId;
  return typeof origin === "string" && origin ? origin : null;
}

/** The ids that identify a chat's story: itself, its group, its scene origin and that origin's group. */
export async function backgroundStoryKeys(chat: StoryChat, getChat: GetChat): Promise<Set<string>> {
  const keys = new Set([chat.id]);
  if (chat.groupId) keys.add(chat.groupId);
  const origin = sceneOriginChatId(chat);
  if (origin) {
    keys.add(origin);
    const originGroup = (await getChat(origin))?.groupId;
    if (originGroup) keys.add(originGroup);
  }
  return keys;
}

/**
 * Filters background filenames to the ones a chat may use: the shared library plus generated backgrounds
 * owned by a chat in the same story. A background whose owner chat no longer exists is hidden.
 */
export async function backgroundsVisibleToChat(
  files: string[],
  meta: Record<string, { chatId?: string } | undefined>,
  chat: StoryChat,
  getChat: GetChat,
): Promise<string[]> {
  const mine = await backgroundStoryKeys(chat, getChat);
  const ownerKeys = new Map<string, Set<string> | null>();
  const visible: string[] = [];
  for (const file of files) {
    const owner = meta[file]?.chatId;
    if (!owner || mine.has(owner)) {
      visible.push(file);
      continue;
    }
    if (!ownerKeys.has(owner)) {
      const ownerChat = await getChat(owner);
      ownerKeys.set(owner, ownerChat ? await backgroundStoryKeys(ownerChat, getChat) : null);
    }
    const keys = ownerKeys.get(owner);
    if (keys && [...keys].some((key) => mine.has(key))) visible.push(file);
  }
  return visible;
}
