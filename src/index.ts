/**
 * WOPR VideoGen Plugin — Capability Plugin
 *
 * Registers /video slash commands on all channel providers and A2A tools
 * for AI agents. Routes video generation requests through the socket layer.
 * Contains ZERO billing logic — socket handles credits.
 */

import type { A2AToolResult, ChannelCommandContext, ConfigSchema, WOPRPlugin, WOPRPluginContext } from "./types.js";

// ============================================================================
// Config Schema
// ============================================================================

const configSchema: ConfigSchema = {
  title: "Video Generation",
  description: "Configure video generation settings",
  fields: [
    {
      name: "provider",
      type: "select",
      label: "Video Provider",
      options: [
        { value: "replicate", label: "Replicate (Hosted)" },
        { value: "custom", label: "Custom Endpoint" },
      ],
      default: "replicate",
      description: "Video generation provider to use",
    },
    {
      name: "model",
      type: "select",
      label: "Default Model",
      options: [
        { value: "minimax-video", label: "Minimax Video-01" },
        { value: "wan-2.1", label: "Wan 2.1" },
        { value: "kling-1.6", label: "Kling 1.6" },
        { value: "luma-ray2", label: "Luma Ray2" },
      ],
      default: "minimax-video",
      description: "Default video model for generation",
    },
    {
      name: "duration",
      type: "select",
      label: "Default Duration",
      options: [
        { value: "3", label: "3 seconds" },
        { value: "5", label: "5 seconds" },
        { value: "10", label: "10 seconds" },
      ],
      default: "5",
      description: "Default video duration in seconds",
    },
    {
      name: "aspectRatio",
      type: "select",
      label: "Default Aspect Ratio",
      options: [
        { value: "16:9", label: "16:9 (Landscape)" },
        { value: "9:16", label: "9:16 (Portrait)" },
        { value: "1:1", label: "1:1 (Square)" },
      ],
      default: "16:9",
      description: "Default aspect ratio for generated videos",
    },
    {
      name: "apiKey",
      type: "password",
      label: "API Key (BYOK)",
      placeholder: "r8_...",
      description: "Your own API key for the provider (optional — uses hosted credits if empty)",
    },
  ],
};

// ============================================================================
// Video generation config type
// ============================================================================

interface VideoGenConfig {
  provider?: string;
  model?: string;
  duration?: string;
  aspectRatio?: string;
  apiKey?: string;
}

// ============================================================================
// Helper: parse /video command arguments
// ============================================================================

function parseVideoArgs(args: string[]): {
  prompt: string;
  model?: string;
  duration?: string;
  aspectRatio?: string;
} {
  const result: { prompt: string; model?: string; duration?: string; aspectRatio?: string } = {
    prompt: "",
  };
  const promptParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model" && i + 1 < args.length) {
      result.model = args[++i];
    } else if (arg === "--duration" && i + 1 < args.length) {
      result.duration = args[++i];
    } else if (arg === "--aspect" && i + 1 < args.length) {
      result.aspectRatio = args[++i];
    } else {
      promptParts.push(arg);
    }
  }

  result.prompt = promptParts.join(" ");
  return result;
}

// ============================================================================
// Helper: parse socket response (JSON or plain URL)
// ============================================================================

function parseSocketResponse(raw: string): { url?: string; error?: string } {
  try {
    return JSON.parse(raw) as { url?: string; error?: string };
  } catch {
    return raw.startsWith("http") ? { url: raw } : { error: raw };
  }
}

// ============================================================================
// Helper: handle /video command
// ============================================================================

async function handleVideoCommand(
  cmdCtx: ChannelCommandContext,
  ctx: WOPRPluginContext,
  config: VideoGenConfig,
): Promise<void> {
  const { args } = cmdCtx;

  // Sub-command: /video settings
  if (args[0] === "settings") {
    const settingsMsg =
      `**Video Generation Settings**\n\n` +
      `**Provider:** ${config.provider ?? "replicate"}\n` +
      `**Model:** ${config.model ?? "minimax-video"}\n` +
      `**Duration:** ${config.duration ?? "5"}s\n` +
      `**Aspect Ratio:** ${config.aspectRatio ?? "16:9"}\n` +
      `**BYOK:** ${config.apiKey ? "Configured" : "Using hosted credits"}`;
    await cmdCtx.reply(settingsMsg);
    return;
  }

  // Sub-command: /video models
  if (args[0] === "models") {
    const modelsMsg =
      `**Available Video Models**\n\n` +
      "`minimax-video` — Minimax Video-01 (fast, good quality)\n" +
      "`wan-2.1` — Wan 2.1 (high quality, slower)\n" +
      "`kling-1.6` — Kling 1.6 (cinematic)\n" +
      "`luma-ray2` — Luma Ray2 (photorealistic)\n\n" +
      "Use: `/video <prompt> --model <name>`";
    await cmdCtx.reply(modelsMsg);
    return;
  }

  // Main: /video <prompt> [--model X] [--duration X] [--aspect X]
  const parsed = parseVideoArgs(args);

  if (!parsed.prompt) {
    await cmdCtx.reply(
      `**Usage:** \`/video <prompt>\`\n\n` +
        `**Options:**\n` +
        `\`--model <name>\` — Model to use (minimax-video, wan-2.1, kling-1.6, luma-ray2)\n` +
        `\`--duration <seconds>\` — Duration (3, 5, 10)\n` +
        `\`--aspect <ratio>\` — Aspect ratio (16:9, 9:16, 1:1)\n\n` +
        `**Sub-commands:**\n` +
        `\`/video settings\` — Show current settings\n` +
        `\`/video models\` — List available models`,
    );
    return;
  }

  const model = parsed.model ?? config.model ?? "minimax-video";
  const duration = parsed.duration ?? config.duration ?? "5";
  const aspectRatio = parsed.aspectRatio ?? config.aspectRatio ?? "16:9";

  // Show progress indicator — video generation is slow (30s-2min)
  await cmdCtx.reply(
    `Generating video... This may take 30s-2min.\n` +
      `**Prompt:** ${parsed.prompt}\n` +
      `**Model:** ${model} | **Duration:** ${duration}s | **Aspect:** ${aspectRatio}`,
  );

  // Route through socket layer via ctx.inject as a capability request
  // The socket layer handles: credit check, adapter routing, billing
  // Plugin contains ZERO billing logic
  try {
    const capabilityRequest = JSON.stringify({
      capability: "video-generation",
      input: {
        prompt: parsed.prompt,
        model,
        duration: Number.parseInt(duration, 10),
        aspectRatio,
      },
    });

    const raw = await ctx.inject("__capability__", capabilityRequest, {
      from: cmdCtx.sender,
      channel: { type: cmdCtx.channelType, id: cmdCtx.channel, name: "video-command" },
      silent: true,
    });

    const result = parseSocketResponse(raw);

    if (result.error) {
      if (result.error === "insufficient_credits") {
        await cmdCtx.reply("You don't have enough credits for video generation. Add credits to continue.");
      } else {
        await cmdCtx.reply(`Video generation failed: ${result.error}`);
      }
      return;
    }

    if (result.url) {
      await cmdCtx.reply(result.url);
    } else {
      await cmdCtx.reply("Video generation completed but no URL was returned.");
    }
  } catch (err) {
    ctx.log.error("Video generation failed", err);
    await cmdCtx.reply(`Video generation failed: ${err}`);
  }
}

// ============================================================================
// Plugin Definition
// ============================================================================

let pluginCtx: WOPRPluginContext | null = null;
const registeredProviderIds: string[] = [];

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-videogen",
  version: "1.0.0",
  description: "Video generation capability plugin — /video in any channel",

  manifest: {
    name: "@wopr-network/wopr-plugin-videogen",
    version: "1.0.0",
    description: "Generate videos with AI — /video in any channel",
    capabilities: ["video-generation"],
    requires: {
      network: {
        outbound: true,
        hosts: ["api.replicate.com"],
      },
    },
    provides: {
      capabilities: [
        {
          type: "video-generation",
          id: "videogen-replicate",
          displayName: "Video Generation (Replicate)",
          tier: "byok",
        },
      ],
    },
    icon: "🎬",
    category: "creative",
    tags: ["videogen", "video", "ai", "replicate", "creative"],
    lifecycle: {
      shutdownBehavior: "drain",
      shutdownTimeoutMs: 120_000, // video gen can take up to 2 minutes
    },
  },

  async init(ctx: WOPRPluginContext) {
    pluginCtx = ctx;

    // 1. Register config schema
    ctx.registerConfigSchema("wopr-plugin-videogen", configSchema);
    const config = ctx.getConfig<VideoGenConfig>();

    // 2. Register A2A tools for AI agents
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer({
        name: "videogen",
        version: "1.0",
        tools: [
          {
            name: "generate_video",
            description:
              "Generate a video from a text prompt. Returns a URL to the generated video. " +
              "Video generation takes 30s-2min. The socket layer handles credit checks automatically.",
            inputSchema: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  description: "Text description of the video to generate",
                },
                model: {
                  type: "string",
                  description: "Video model to use (minimax-video, wan-2.1, kling-1.6, luma-ray2)",
                },
                duration: {
                  type: "number",
                  description: "Video duration in seconds (3, 5, or 10)",
                },
                aspectRatio: {
                  type: "string",
                  description: "Aspect ratio (16:9, 9:16, 1:1)",
                },
                sessionId: {
                  type: "string",
                  description: "Session ID for context",
                },
              },
              required: ["prompt"],
            },
            async handler(args: Record<string, unknown>): Promise<A2AToolResult> {
              if (!pluginCtx) {
                return { content: [{ type: "text", text: "Plugin not initialized" }], isError: true };
              }

              const prompt = args.prompt as string;
              const model = (args.model as string | undefined) ?? config?.model ?? "minimax-video";
              const duration = (args.duration as number | undefined) ?? Number.parseInt(config?.duration ?? "5", 10);
              const aspectRatio = (args.aspectRatio as string | undefined) ?? config?.aspectRatio ?? "16:9";

              try {
                const capabilityRequest = JSON.stringify({
                  capability: "video-generation",
                  input: { prompt, model, duration, aspectRatio },
                });

                const raw = await pluginCtx.inject("__capability__", capabilityRequest, { silent: true });
                const result = parseSocketResponse(raw);

                if (result.error) {
                  return {
                    content: [{ type: "text", text: `Video generation failed: ${result.error}` }],
                    isError: true,
                  };
                }

                return { content: [{ type: "text", text: result.url ?? "No URL returned" }] };
              } catch (err) {
                return {
                  content: [{ type: "text", text: `Video generation error: ${err}` }],
                  isError: true,
                };
              }
            },
          },
          {
            name: "list_video_models",
            description: "List available video generation models and their capabilities",
            inputSchema: {
              type: "object",
              properties: {},
            },
            async handler(): Promise<A2AToolResult> {
              const models = [
                { id: "minimax-video", name: "Minimax Video-01", speed: "fast", quality: "good" },
                { id: "wan-2.1", name: "Wan 2.1", speed: "slow", quality: "high" },
                { id: "kling-1.6", name: "Kling 1.6", speed: "medium", quality: "cinematic" },
                { id: "luma-ray2", name: "Luma Ray2", speed: "medium", quality: "photorealistic" },
              ];
              return { content: [{ type: "text", text: JSON.stringify(models, null, 2) }] };
            },
          },
          {
            name: "get_video_settings",
            description: "Get current video generation configuration settings",
            inputSchema: {
              type: "object",
              properties: {},
            },
            async handler(): Promise<A2AToolResult> {
              const currentConfig = pluginCtx?.getConfig<VideoGenConfig>() ?? {};
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        provider: currentConfig.provider ?? "replicate",
                        model: currentConfig.model ?? "minimax-video",
                        duration: currentConfig.duration ?? "5",
                        aspectRatio: currentConfig.aspectRatio ?? "16:9",
                        byokConfigured: !!currentConfig.apiKey,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            },
          },
        ],
      });
      ctx.log.info("Registered VideoGen A2A tools");
    }

    // 3. Register /video command on all available channel providers
    const channelProviders = ctx.getChannelProviders();
    for (const provider of channelProviders) {
      provider.registerCommand({
        name: "video",
        description: "Generate a video from a text prompt",
        async handler(cmdCtx: ChannelCommandContext) {
          if (!pluginCtx) return;
          const currentConfig = pluginCtx.getConfig<VideoGenConfig>();
          await handleVideoCommand(cmdCtx, pluginCtx, currentConfig);
        },
      });
      registeredProviderIds.push(provider.id);
      ctx.log.info(`Registered /video command on ${provider.id} channel`);
    }

    // 4. Listen for new channel providers coming online and register /video on them too
    // Uses wildcard "*" event to catch custom "capability:providerRegistered" events
    ctx.events.on("*", async (payload) => {
      const event = payload as { type?: string } | undefined;
      if (!pluginCtx || event?.type !== "capability:providerRegistered") return;
      const providers = pluginCtx.getChannelProviders();
      for (const provider of providers) {
        if (!registeredProviderIds.includes(provider.id)) {
          provider.registerCommand({
            name: "video",
            description: "Generate a video from a text prompt",
            async handler(cmdCtx: ChannelCommandContext) {
              if (!pluginCtx) return;
              const currentConfig = pluginCtx.getConfig<VideoGenConfig>();
              await handleVideoCommand(cmdCtx, pluginCtx, currentConfig);
            },
          });
          registeredProviderIds.push(provider.id);
          pluginCtx.log.info(`Registered /video command on late-joining ${provider.id} channel`);
        }
      }
    });

    ctx.log.info("VideoGen plugin initialized");
  },

  async shutdown() {
    // Unregister /video command from all channel providers
    if (pluginCtx) {
      for (const providerId of registeredProviderIds) {
        const provider = pluginCtx.getChannelProvider(providerId);
        if (provider) {
          provider.unregisterCommand("video");
        }
      }
    }
    registeredProviderIds.length = 0;
    pluginCtx = null;
  },
};

export default plugin;
