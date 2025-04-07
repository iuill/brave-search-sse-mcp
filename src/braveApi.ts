import { BraveWeb, BravePoiResponse, BraveDescription } from "./types.js";

const RATE_LIMIT = {
  perSecond: 1,
  perMonth: 15000,
};

const requestCount = {
  second: 0,
  month: 0,
  lastReset: Date.now(),
};

function checkRateLimit() {
  const now = Date.now();
  // Reset second count every second
  if (now - requestCount.lastReset > 1000) {
    requestCount.second = 0;
    requestCount.lastReset = now;
  }
  // Check limits
  if (
    requestCount.second >= RATE_LIMIT.perSecond ||
    requestCount.month >= RATE_LIMIT.perMonth
  ) {
    throw new Error("Rate limit exceeded");
  }
  requestCount.second++;
  requestCount.month++;
}

async function getPoisData(ids: string[]): Promise<BravePoiResponse> {
  checkRateLimit();
  const url = new URL("https://api.search.brave.com/res/v1/local/pois");
  ids.filter(Boolean).forEach((id) => url.searchParams.append("ids", id));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Brave API error (POI): ${response.status} ${response.statusText}\n${await response.text()}`,
    );
  }

  const poisResponse = (await response.json()) as BravePoiResponse;
  return poisResponse;
}

async function getDescriptionsData(ids: string[]): Promise<BraveDescription> {
  checkRateLimit();
  const url = new URL("https://api.search.brave.com/res/v1/local/descriptions");
  ids.filter(Boolean).forEach((id) => url.searchParams.append("ids", id));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Brave API error (Descriptions): ${response.status} ${response.statusText}\n${await response.text()}`,
    );
  }

  const descriptionsData = (await response.json()) as BraveDescription;
  return descriptionsData;
}

function formatLocalResults(
  poisData: BravePoiResponse,
  descData: BraveDescription,
): string {
  return (
    (poisData.results || [])
      .map((poi) => {
        const address =
          [
            poi.address?.streetAddress ?? "",
            poi.address?.addressLocality ?? "",
            poi.address?.addressRegion ?? "",
            poi.address?.postalCode ?? "",
          ]
            .filter((part) => part !== "")
            .join(", ") || "N/A";

        return `Name: ${poi.name}
Address: ${address}
Phone: ${poi.phone || "N/A"}
Rating: ${poi.rating?.ratingValue ?? "N/A"} (${poi.rating?.ratingCount ?? 0} reviews)
Price Range: ${poi.priceRange || "N/A"}
Hours: ${(poi.openingHours || []).join(", ") || "N/A"}
Description: ${descData.descriptions[poi.id] || "No description available"}
`;
      })
      .join("\n---\n") || "No local results found"
  );
}

export async function performWebSearch(
  query: string,
  count: number = 10,
  offset: number = 0,
): Promise<string> {
  checkRateLimit();
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", Math.min(count, 20).toString()); // API limit
  url.searchParams.set("offset", offset.toString());

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Brave API error (Web Search): ${response.status} ${response.statusText}\n${await response.text()}`,
    );
  }

  const data = (await response.json()) as BraveWeb;

  // Extract just web results
  const results = (data.web?.results || []).map((result) => ({
    title: result.title || "",
    description: result.description || "",
    url: result.url || "",
  }));

  return results
    .map(
      (r) => `Title: ${r.title}\nDescription: ${r.description}\nURL: ${r.url}`,
    )
    .join("\n\n");
}

export async function performLocalSearch(
  query: string,
  count: number = 5,
): Promise<string> {
  checkRateLimit();
  // Initial search to get location IDs
  const webUrl = new URL("https://api.search.brave.com/res/v1/web/search");
  webUrl.searchParams.set("q", query);
  webUrl.searchParams.set("search_lang", "en");
  webUrl.searchParams.set("result_filter", "locations");
  webUrl.searchParams.set("count", Math.min(count, 20).toString());

  const webResponse = await fetch(webUrl, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!webResponse.ok) {
    throw new Error(
      `Brave API error (Local Initial): ${webResponse.status} ${webResponse.statusText}\n${await webResponse.text()}`,
    );
  }

  const webData = (await webResponse.json()) as BraveWeb;
  const locationIds =
    webData.locations?.results
      ?.filter((r): r is { id: string; title?: string } => r.id != null)
      .map((r) => r.id) || [];

  if (locationIds.length === 0) {
    console.log(
      "No local results found for query, falling back to web search:",
      query,
    );
    return performWebSearch(query, count); // Fallback to web search
  }

  // Get POI details and descriptions in parallel
  try {
    const [poisData, descriptionsData] = await Promise.all([
      getPoisData(locationIds),
      getDescriptionsData(locationIds),
    ]);
    return formatLocalResults(poisData, descriptionsData);
  } catch (error) {
    console.error(
      "Error fetching POI/Description data, falling back to web search:",
      error,
    );
    return performWebSearch(query, count); // Fallback on error during detail fetch
  }
}
