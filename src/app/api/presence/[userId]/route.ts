import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  discriminator: string;
}

interface LanyardActivity {
  type: number;
  state?: string;
  name: string;
  id: string;
  details?: string;
  timestamps?: {
    start?: number;
    end?: number;
  };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
}

interface LanyardData {
  discord_user: DiscordUser;
  discord_status: "online" | "idle" | "dnd" | "offline";
  activities: LanyardActivity[];
}

interface LanyardResponse {
  success: boolean;
  data?: LanyardData;
  error?: {
    message: string;
    code: string;
  };
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

  if (!userId) {
    return new NextResponse("User ID is required", { status: 400 });
  }

  try {
    const lanyardReq = await fetch(`https://api.lanyard.rest/v1/users/${userId}`);
    const lanyardRes: LanyardResponse = await lanyardReq.json();

    let user: DiscordUser | null = null;
    let status = "offline";
    let activities: LanyardActivity[] = [];

    if (lanyardRes.success && lanyardRes.data) {
      user = lanyardRes.data.discord_user;
      status = lanyardRes.data.discord_status;
      activities = lanyardRes.data.activities;
    } else {
      const discordToken = process.env.DISCORD_TOKEN;
      if (discordToken) {
        const discordReq = await fetch(`https://discord.com/api/v10/users/${userId}`, {
          headers: {
            Authorization: `Bot ${discordToken}`,
          },
        });
        if (discordReq.ok) {
          user = await discordReq.json();
        }
      }
    }

    if (!user) {
      return new NextResponse(generateErrorSvg("Koleth System: User Offline"), {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        },
      });
    }

    const isGif = user.avatar?.startsWith("a_");
    const avatarExt = isGif ? "gif" : "png";
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${avatarExt}?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || "0") % 5}.png`;
    const avatarBase64 = await fetchImageAsBase64(avatarUrl);

    const displayName = escapeXml(user.global_name || user.username);
    const usernameText = escapeXml(`@${user.username}`);

    const statusColorMap: Record<string, string> = {
      online: "#23a559",
      idle: "#f1c40f",
      dnd: "#f23f43",
      offline: "#80848e",
    };
    const currentStatusColor = statusColorMap[status] || statusColorMap.offline;

    const customStatus = activities.find((a) => a.type === 4);
    const mainActivity = activities.find((a) => a.type !== 4);

    const svgContent = generateSuccessSvg({
      displayName,
      usernameText,
      avatarBase64,
      statusColor: currentStatusColor,
      customStatus: customStatus ? escapeXml(customStatus.state || "") : null,
      activity: mainActivity,
    });

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    console.error("Error generating presence SVG:", error);
    return new NextResponse(generateErrorSvg("Koleth System: Error Generating Profile"), {
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
  activity,
}: {
  displayName: string;
  usernameText: string;
  avatarBase64: string;
  statusColor: string;
  customStatus: string | null;
  activity?: LanyardActivity;
}): string {
  const actName = activity?.name ? escapeXml(activity.name) : null;
  const actDetails = activity?.details ? escapeXml(activity.details) : null;
  const actState = activity?.state ? escapeXml(activity.state) : null;

  let activitySvg = "";
  if (actName) {
    activitySvg = `
      <g transform="translate(150, 100)">
        <rect width="4" height="40" rx="2" fill="#8b5cf6" />
        <text x="14" y="10" fill="#a855f7" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="bold">${actName}</text>
        ${actDetails ? `<text x="14" y="26" fill="#cbd5e1" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="12">${actDetails}</text>` : ""}
        ${actState ? `<text x="14" y="${actDetails ? "42" : "26"}" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="12">${actState}</text>` : ""}
      </g>
    `;
  } else if (customStatus) {
    activitySvg = `
      <g transform="translate(150, 100)">
        <text x="0" y="10" fill="#e1e1e6" font-style="italic" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13">${customStatus}</text>
      </g>
    `;
  } else {
    activitySvg = `
      <g transform="translate(150, 100)">
        <text x="0" y="10" fill="#80848e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13">No active status</text>
      </g>
    `;
  }

  // To properly mask a rounded image in SVG, we use clipPath or pattern. pattern is safer across SVG renderers.
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

    <!-- Name and Discriminator -->
    <text x="150" y="65" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="28" font-weight="800">${displayName}</text>
    <text x="150" y="85" fill="#A8A8B3" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="500">${usernameText}</text>
    
    <!-- Activity Area -->
    ${activitySvg}
  </svg>`;
}
