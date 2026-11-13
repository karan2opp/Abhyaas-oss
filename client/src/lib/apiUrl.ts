// The API address the site should call. In development it is usually written as localhost, which only works on the
// computer that runs it: a phone that opens the site by this computer's network address (192.168.x.x) would be calling
// itself. So when the address is a localhost one but the page was opened from another address, the API is looked for on
// that same address. A real (deployed) API address is never touched.
const configured = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];

export const apiBaseUrl = (): string => {
  if (typeof window === "undefined") return configured;
  try {
    const url = new URL(configured);
    const openedFrom = window.location.hostname;
    if (LOOPBACK.includes(url.hostname) && !LOOPBACK.includes(openedFrom)) {
      url.hostname = openedFrom;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // an address that does not parse is used as it is
  }
  return configured;
};
