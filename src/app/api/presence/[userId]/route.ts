import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

interface KolethPresenceData {
  user: {
    id: string;
    username: string;
    global_name: string | null;
    avatar_url: string | null;
  };
  status: "online" | "idle" | "dnd" | "offline";
  activities: any[];
}

const escapeXml = (unsafe: string | null | undefined) => {
  if (!unsafe) return "";
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
};

async function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchImageAsBase64(url: string, fallbackUrl?: string): Promise<string> {
  if (url.startsWith("data:image")) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (fallbackUrl) return fetchImageAsBase64(fallbackUrl);
      return "";
    }
    const arrayBuffer = await response.arrayBuffer();
    const base64 = await arrayBufferToBase64(arrayBuffer);
    const contentType = response.headers.get("content-type") || "image/png";
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    if (fallbackUrl) return fetchImageAsBase64(fallbackUrl);
    return "";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const routeParams = await params;
  const userId = routeParams.userId;
  const theme = request.nextUrl.searchParams.get("theme");

  if (!userId) {
    return new NextResponse("User ID is required", { status: 400 });
  }

  try {
    // Fetch custom presence JSON from Koleth endpoint
    // The endpoint might be dynamic like /presence.json?id=... or just a single file.
    // Based on user prompt: "direkt https://koleth.net.tr/presence.json adresinden veriyi çeksin"
    const kolethReq = await fetch(`https://koleth.net.tr/api/statusai/presence.json`, {
      headers: {
        "User-Agent": "Koleth-Presence-Worker/1.0",
      },
      cache: "no-store"
    });

    if (!kolethReq.ok) {
      return new NextResponse(generateErrorSvg("Koleth System: Endpoint Down"), {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
          "Surrogate-Control": "no-store",
        },
      });
    }

    const data: KolethPresenceData = await kolethReq.json();

    const userObj = data.user || {} as any;
    const status = data.status || "offline";
    const activities = data.activities || [];

    // Process Avatar
    let avatarUrl = userObj.avatar_url;

    const avatarBase64 = await fetchImageAsBase64(avatarUrl || `https://cdn.discordapp.com/embed/avatars/0.png`);

    const displayName = escapeXml(userObj.global_name || userObj.username || "Unknown System");
    const usernameText = escapeXml(userObj.username ? `@${userObj.username}` : "@system");

    console.log("KolethPresenceData => User:", userObj);
    console.log("KolethPresenceData => Status:", status);
    console.log("KolethPresenceData => Activities:", activities);

    const statusColorMap: Record<string, string> = {
      online: "#23a559",
      idle: "#f1c40f",
      dnd: "#f23f43",
      offline: "#80848e",
    };
    const currentStatusColor = statusColorMap[status] || statusColorMap.offline;

    // Advanced Activity Sorting based on the exact JSON schema provided
    const customStatus = activities.find((a: any) => a.type === "custom");
    const spotifyActivity = activities.find((a: any) => a.name === "Spotify");
    const otherActivity = activities.find((a: any) => a.type !== "custom" && a.name !== "Spotify");

    const svgContent = generateSuccessSvg({
      displayName,
      usernameText,
      avatarBase64,
      statusColor: currentStatusColor,
      customStatus: customStatus ? escapeXml(customStatus.state || "") : null,
      spotify: spotifyActivity ? {
        details: escapeXml(spotifyActivity.title ? String(spotifyActivity.title) : "Unknown Song"),
        state: escapeXml(spotifyActivity.artist ? String(spotifyActivity.artist) : "Unknown Artist"),
      } : null,
      activity: otherActivity || null,
      theme,
    });

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Surrogate-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error generating presence SVG:", error);
    return new NextResponse(generateErrorSvg("Koleth System: Parse Error"), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Surrogate-Control": "no-store",
      },
    });
  }
}

function generateErrorSvg(message: string): string {
  return `<svg width="500" height="180" xmlns="http://www.w3.org/2000/svg">
    <rect width="500" height="180" rx="16" fill="#0A0A0E" stroke="#8b5cf6" stroke-width="2"/>
    <text x="250" y="90" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="20" font-weight="600" text-anchor="middle" dominant-baseline="middle">
      ${message}
    </text>
  </svg>`;
}

function generateSuccessSvg({
  displayName,
  usernameText,
  avatarBase64,
  statusColor,
  customStatus,
  spotify,
  activity,
  theme,
}: {
  displayName: string;
  usernameText: string;
  avatarBase64: string;
  statusColor: string;
  customStatus: string | null;
  spotify: { details: string; state: string; } | null;
  activity?: KolethPresenceData["activities"][0];
  theme?: string | null;
}): string {
  const is8bit = theme === "8bit";
  const fontFamily = is8bit
    ? "'Press Start 2P', monospace"
    : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  const fontStyles = is8bit
    ? `<style>
         @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&amp;display=swap');
       </style>`
    : "";

  const nameSize = is8bit ? 14 : 22;
  const tagSize = is8bit ? 8 : 12;
  const storySize = is8bit ? 9 : 13;
  const actNameSize = is8bit ? 10 : 13;
  const actDetailSize = is8bit ? 9 : 12;
  const actStateSize = is8bit ? 9 : 12;
  const spotifyDetailSize = is8bit ? 9 : 12;

  const actName = activity?.name ? escapeXml(String(activity.name)) : null;
  const actDetails = activity?.details ? escapeXml(String(activity.details)) : null;
  const actState = activity?.state ? escapeXml(String(activity.state)) : null;

  let storySvg = "";
  if (customStatus) {
    storySvg = `
      <text x="150" y="28" fill="#e1e1e6" font-style="italic" font-family="${fontFamily}" font-size="${storySize}">“${customStatus}”</text>
    `;
  }

  let activitySvg = "";
  if (actName) {
    activitySvg = `
      <text x="150" y="85" fill="#a855f7" font-family="${fontFamily}" font-size="${actNameSize}" font-weight="bold">${actName}</text>
      ${actDetails ? `<text x="150" y="110" fill="#cbd5e1" font-family="${fontFamily}" font-size="${actDetailSize}">${actDetails}</text>` : ""}
      ${actState ? `<text x="150" y="${actDetails ? "125" : "110"}" fill="#94a3b8" font-family="${fontFamily}" font-size="${actStateSize}">${actState}</text>` : ""}
    `;
  }

  let spotifySvg = "";
  if (spotify) {
    // Spotify Icon Path (Simple generic music note / Spotify circle)
    const spotifyIcon = `<path fill="#1DB954" d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0zm7.327 23.139c-.198.324-.616.425-.94.227-2.583-1.579-5.83-1.936-9.663-1.06-.356.082-.71-.141-.792-.497-.082-.356.141-.71.497-.792 4.194-.959 7.787-.552 10.67 1.21.325.197.426.616.228.912zm1.341-3.003c-.247.404-.766.53-1.171.282-2.964-1.823-7.509-2.378-10.978-1.325-.453.138-.925-.119-1.063-.572-.138-.453.119-.925.572-1.063 3.961-1.201 9.006-.578 12.359 1.483.404.249.531.768.281 1.195zm.116-3.138c-3.551-2.108-9.407-2.302-12.793-1.275-.54.164-1.109-.142-1.274-.682-.164-.54.142-1.109.682-1.274 3.963-1.203 10.457-.969 14.613 1.499.488.29.646.916.355 1.405-.29.489-.916.647-1.405.355z" />`;
    spotifySvg = `
      <g transform="translate(150, 145)">
        <g transform="translate(0, -12) scale(0.6)">${spotifyIcon}</g>
        <text x="24" y="0" font-family="${fontFamily}" font-size="${spotifyDetailSize}">
          <tspan fill="#1DB954" font-weight="600">Dinliyor: </tspan>
          <tspan fill="#e1e1e6">${spotify.details} - ${spotify.state}</tspan>
        </text>
      </g>
    `;
  }

  // Adjust Y positions of main text based on the presence of storytelling
  const mainY = 55;

  return `<svg width="500" height="180" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    ${fontStyles}
    <defs>
      <clipPath id="avatar-clip">
        <circle cx="80" cy="90" r="45" />
      </clipPath>
      <clipPath id="status-clip">
        <circle cx="112" cy="122" r="14" />
      </clipPath>
      <linearGradient id="koleth-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#14141e" />
        <stop offset="100%" stop-color="#0A0A0E" />
      </linearGradient>
    </defs>
    
    <!-- Background Card -->
    <rect width="500" height="180" rx="16" fill="url(#koleth-gradient)" stroke="#8b5cf6" stroke-width="2"/>
    
    <!-- Floating purple accents -->
    <circle cx="480" cy="20" r="40" fill="#8b5cf6" opacity="0.1" filter="blur(20px)" />
    <circle cx="20" cy="160" r="30" fill="#a855f7" opacity="0.1" filter="blur(15px)" />

    <!-- Avatar -->
    <g>
      <circle cx="80" cy="90" r="47" fill="#1b1b29" />
      ${avatarBase64 ? `<image x="35" y="45" width="90" height="90" href="${avatarBase64}" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMid slice" />` : ""}
    </g>

    <!-- Status Indicator Background & Circle -->
    <circle cx="113" cy="123" r="16" fill="#0A0A0E" />
    <circle cx="113" cy="123" r="12" fill="${statusColor}" />

    <!-- Name and Storytelling -->
    ${storySvg}
    <text x="150" y="${mainY}" fill="#FFFFFF" font-family="${fontFamily}" font-size="${nameSize}" font-weight="800">${displayName}</text>
    <text x="150" y="${mainY + 18}" fill="#A8A8B3" font-family="${fontFamily}" font-size="${tagSize}" font-weight="500">${usernameText}</text>
    
    <!-- Activity Area -->
    ${activitySvg}
    ${spotifySvg}
  </svg>`;
}
