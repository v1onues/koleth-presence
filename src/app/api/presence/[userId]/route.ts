import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

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

const escapeXml = (unsafe: string) => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
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
  // Although userId is in params, since the endpoint is currently hardcoded to koleth.net.tr/presence.json
  // we might just fetch the single JSON file. If the JSON is meant to be user specific, 
  // we could append it, but the prompt says 'direkt https://koleth.net.tr/presence.json adresinden veriyi çeksin'.
  const routeParams = await params;
  const userId = routeParams.userId;

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
      next: { revalidate: 30 }
    });

    if (!kolethReq.ok) {
      return new NextResponse(generateErrorSvg("Koleth System: Endpoint Down"), {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
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
        details: escapeXml((spotifyActivity as any).title || "Unknown Song"),
        state: escapeXml((spotifyActivity as any).artist || "Unknown Artist"),
      } : null,
      activity: otherActivity as any,
    });

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    console.error("Error generating presence SVG:", error);
    return new NextResponse(generateErrorSvg("Koleth System: Parse Error"), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
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
}: {
  displayName: string;
  usernameText: string;
  avatarBase64: string;
  statusColor: string;
  customStatus: string | null;
  spotify: { details: string; state: string; } | null;
  activity?: KolethPresenceData["activities"][0];
}): string {
  const actName = activity?.name ? escapeXml(activity.name) : null;
  const actDetails = activity?.details ? escapeXml(activity.details) : null;
  const actState = activity?.state ? escapeXml(activity.state) : null;

  let storySvg = "";
  if (customStatus) {
    storySvg = `
      <text x="150" y="38" fill="#e1e1e6" font-style="italic" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14">“${customStatus}”</text>
    `;
  }

  let activitySvg = "";
  if (actName) {
    activitySvg = `
      <g transform="translate(150, 110)">
        <text x="0" y="10" fill="#a855f7" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="bold">${actName}</text>
        ${actDetails ? `<text x="0" y="26" fill="#cbd5e1" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="12">${actDetails}</text>` : ""}
        ${actState ? `<text x="0" y="${actDetails ? "42" : "26"}" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="12">${actState}</text>` : ""}
      </g>
    `;
  }

  let spotifySvg = "";
  if (spotify) {
    // Spotify Icon Path (Simple generic music note / Spotify circle)
    const spotifyIcon = `<path fill="#1DB954" d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0zm7.327 23.139c-.198.324-.616.425-.94.227-2.583-1.579-5.83-1.936-9.663-1.06-.356.082-.71-.141-.792-.497-.082-.356.141-.71.497-.792 4.194-.959 7.787-.552 10.67 1.21.325.197.426.616.228.912zm1.341-3.003c-.247.404-.766.53-1.171.282-2.964-1.823-7.509-2.378-10.978-1.325-.453.138-.925-.119-1.063-.572-.138-.453.119-.925.572-1.063 3.961-1.201 9.006-.578 12.359 1.483.404.249.531.768.281 1.195zm.116-3.138c-3.551-2.108-9.407-2.302-12.793-1.275-.54.164-1.109-.142-1.274-.682-.164-.54.142-1.109.682-1.274 3.963-1.203 10.457-.969 14.613 1.499.488.29.646.916.355 1.405-.29.489-.916.647-1.405.355z" />`;
    // Place at bottom right or bottom left. Bottom right might overlap, let's put it aligned to the left under main name.
    spotifySvg = `
      <g transform="translate(150, 145)">
        <g transform="scale(0.6)">${spotifyIcon}</g>
        <text x="24" y="14" fill="#1DB954" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="600">Dinliyor: </text>
        <text x="80" y="14" fill="#e1e1e6" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13">${spotify.details} - ${spotify.state}</text>
      </g>
    `;
  }

  // Adjust Y positions of main text based on the presence of storytelling
  const mainY = customStatus ? 65 : 55;

  return `<svg width="500" height="180" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
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
    <text x="150" y="${mainY}" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="28" font-weight="800">${displayName}</text>
    <text x="150" y="${mainY + 20}" fill="#A8A8B3" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="500">${usernameText}</text>
    
    <!-- Activity Area -->
    ${activitySvg}
    ${spotifySvg}
  </svg>`;
}
