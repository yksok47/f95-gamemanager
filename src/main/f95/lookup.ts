import { load } from "cheerio";
import { parseCountText, saneLikeCount, saneViewCount } from "@shared/counts";
import type { CatalogGame } from "@shared/types";
import { fetchCatalog } from "./catalog";
import { catalogLookupAttempts } from "./catalog-lookup-attempts";
import { f95Fetch } from "./http";
import { parseGameTitle } from "./parse";

export type GameDetails = Pick<
  CatalogGame,
  | "title"
  | "creator"
  | "version"
  | "coverUrl"
  | "rating"
  | "likes"
  | "views"
  | "updatedAt"
  | "timestamp"
  | "tags"
  | "prefixes"
  | "screens"
>;

function detailsFromCatalog(game: CatalogGame): GameDetails {
  return {
    title: game.title,
    creator: game.creator,
    version: game.version,
    coverUrl: game.coverUrl,
    rating: game.rating,
    likes: game.likes,
    views: game.views,
    updatedAt: game.updatedAt,
    timestamp: game.timestamp,
    tags: game.tags ?? [],
    prefixes: game.prefixes ?? [],
    screens: game.screens ?? [],
  };
}

export function parseThreadCounts($: ReturnType<typeof load>): { likes: number; views: number } {
  let views = 0
  let likes = 0

  // Thread pages often omit view counts; never read similar-thread / sidebar widgets.
  const viewBlocks = [
    $(".p-description").first().text(),
    $(".p-title-meta").first().text(),
    $(".p-description ul.listInline, .p-title ul.listInline").first().text(),
  ];
  for (const text of viewBlocks) {
    const match = text.match(/Views?:\s*([\d,.]+(?:\.\d+)?\s*[kmb]?)/i);
    views = saneViewCount(parseCountText(match?.[1]));
    if (views) break;
  }

  $(".p-body-header dt, .p-description dt, .p-title-meta dt, .p-title dt").each((_, el) => {
    const node = $(el);
    const label = node.text().replace(/\s+/g, " ").trim();
    const value = (node.next("dd").text() || node.prev("dd").text()).replace(/\s+/g, " ").trim();
    if (!views && /^views?$/i.test(label)) views = saneViewCount(parseCountText(value));
    if (!likes && /^(likes?|reactions?)$/i.test(label)) likes = saneLikeCount(parseCountText(value));
  });

  const post = $(".message-threadStarterPost").first().length
    ? $(".message-threadStarterPost").first()
    : $("article.message--post, .message--post").first();
  if (!likes) {
    likes = saneLikeCount(parseCountText(post.find("[data-reaction-count]").first().attr("data-reaction-count")));
  }
  if (!likes) {
    const link = post.find('a.reactionsBar-link, .message-attribution-opposite a[href*="/reactions"]').first();
    const text = link.text().replace(/\s+/g, " ").trim();
    const others = text.match(/and\s+([\d,.]+)\s+others/i);
    let fromPeople = 0;
    if (others) {
      const extra = parseCountText(others[1]);
      const named = link.find("bdi, .username").length || Math.min(3, (text.match(/,/g) || []).length + 1);
      fromPeople = extra + Math.max(1, named);
    }
    likes = saneLikeCount(
      parseCountText(link.attr("data-reaction-count")) ||
        fromPeople ||
        parseCountText(link.attr("title")) ||
        parseCountText(text),
    );
  }

  return { likes, views };
}

export function isWeakCover(url: string | null | undefined): boolean {
  if (!url) return true;
  return /^(data:)|\/styles\/|\/data\/avatars\/|\/data\/assets\/|\/data\/covers\/|favicon|default.?logo|xenforo|smilies?\//i.test(
    url,
  );
}

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url, "https://f95zone.to/").href;
  } catch {
    return url;
  }
}

function coverFromThread($: ReturnType<typeof load>): string | null {
  const candidates = [
    $('meta[property="og:image"]').attr("content"),
    ...$(".message-body")
      .first()
      .find("img:not(.smilie):not(.reaction)")
      .toArray()
      .map(
        (el) =>
          $(el).attr("data-src") || $(el).attr("data-url") || $(el).attr("src"),
      ),
  ];
  for (const candidate of candidates) {
    const url = absolutize(candidate);
    if (url && !isWeakCover(url)) return url;
  }
  return null;
}

function stripF95Suffix(value: string): string {
  return value.replace(/\s+\|\s+F95zone.*$/i, "").trim();
}

export function headingTitle($: ReturnType<typeof load>): string {
  const heading = $("h1.p-title-value, h1.p-title-page, .p-title h1").first().clone();
  heading.find(".label, .label-append, [class^='pre-'], [class*=' pre-']").remove();
  heading.find("a.labelLink").each((_, el) => {
    const node = $(el);
    const text = node.text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!text) node.remove();
    else node.replaceWith(node.contents());
  });
  const fromHeading = heading
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const og = stripF95Suffix($('meta[property="og:title"]').attr("content") || "");
  const doc = stripF95Suffix($("title").first().text() || "");
  return fromHeading || og || doc;
}

function threadStarter($: ReturnType<typeof load>): string {
  const post = $(".message-threadStarterPost").first().length
    ? $(".message-threadStarterPost").first()
    : $(".message--post").first();
  return (
    post
      .find(
        ".message-userDetails a.username, h4.message-name a.username, a.username",
      )
      .first()
      .text()
      .trim() || $(".p-description").find("a.username").last().text().trim()
  );
}

async function scrapeThread(threadId: number): Promise<GameDetails | null> {
  const { body } = await f95Fetch(`/threads/${threadId}/`);
  const $ = load(body);
  const rawTitle = headingTitle($);
  if (!rawTitle) return null;

  const parsed = parseGameTitle(rawTitle);
  const starter = threadStarter($);
  const counts = parseThreadCounts($);

  return {
    title: parsed.title || rawTitle,
    creator: starter || parsed.creator,
    version: parsed.version,
    coverUrl: coverFromThread($),
    rating: 0,
    likes: counts.likes,
    views: counts.views,
    updatedAt: "",
    timestamp: 0,
    tags: [],
    prefixes: [],
    screens: [],
  };
}

export async function lookupCatalogGame(
  threadId: number,
  title: string,
  creator?: string,
): Promise<CatalogGame | null> {
  for (const attempt of catalogLookupAttempts(title, creator)) {
    try {
      const page = await fetchCatalog({
        search: attempt.search,
        creator: attempt.creator,
        rows: 90,
        page: 1,
      });
      const match = page.games.find((game) => game.threadId === threadId);
      if (match) return match;
    } catch {
      // Try the next, narrower search.
    }
  }
  return null;
}

export async function lookupGame(
  threadId: number,
  title: string,
  creator?: string,
): Promise<GameDetails | null> {
  const catalogHit = await lookupCatalogGame(threadId, title, creator);
  if (catalogHit) return detailsFromCatalog(catalogHit);

  try {
    const scraped = await scrapeThread(threadId);
    if (!scraped) return null;
    const retry = await lookupCatalogGame(
      threadId,
      scraped.title || title,
      scraped.creator || creator,
    );
    if (retry) return detailsFromCatalog(retry);
    return scraped;
  } catch {
    return null;
  }
}
