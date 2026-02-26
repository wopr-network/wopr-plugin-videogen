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
      secret: true,
      setupFlow: "paste",
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

  // Credit confirmation — video generation is expensive; require explicit consent
  const confirmation = await ctx.inject(
    "__confirm__",
    `This will consume credits to generate a video (approx. ${duration}s at ${aspectRatio}). Proceed? (yes/no)`,
    {
      from: cmdCtx.sender,
      channel: { type: cmdCtx.channelType, id: cmdCtx.channel, name: "video-command" },
      silent: false,
    },
  );
  if (!confirmation || !["yes", "y"].includes(confirmation.trim().toLowerCase())) {
    await cmdCtx.reply("Video generation cancelled.");
    return;
  }

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
        duration: Number(duration),
        aspectRatio,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
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
        ctx.log.error("Video generation API error", result.error);
        await cmdCtx.reply("Video generation failed. Please try again.");
      }
      return;
    }

    if (result.url) {
      await cmdCtx.reply(result.url);
    } else {
      await cmdCtx.reply("Video generation completed but no URL was returned.");
    }
  } catch (error: unknown) {
    ctx.log.error("Video generation failed", error);
    await cmdCtx.reply("Video generation failed. Please try again.");
  }
}

// ============================================================================
// Plugin Definition
// ============================================================================

let pluginCtx: WOPRPluginContext | null = null;
const registeredProviderIds: string[] = [];
const cleanups: Array<() => void> = [];

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
    configSchema,
  },

  async init(ctx: WOPRPluginContext) {
    pluginCtx = ctx;

    // 1. Register config schema
    ctx.registerConfigSchema("wopr-plugin-videogen", configSchema);
    const config = ctx.getConfig<VideoGenConfig>();

    // 1b. Register capability provider
    ctx.registerCapabilityProvider("video-generation", {
      id: "videogen-replicate",
      name: "Video Generation (Replicate)",
    });

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
              "Video generation takes 30s-2min. Credit checks are enforced by the socket layer — " +
              "no interactive confirmation is required from the caller; ensure the user has consented " +
              "before invoking this tool.",
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
              const duration = (args.duration as number | undefined) ?? Number(config?.duration ?? "5");
              const aspectRatio = (args.aspectRatio as string | undefined) ?? config?.aspectRatio ?? "16:9";

              // A2A callers are AI agents acting on behalf of users who have already consented
              // at the orchestration level (e.g. the human approved the agent task). There is no
              // interactive user present to respond to a __confirm__ prompt, so we skip that step
              // here. The socket layer still enforces credit checks and will return
              // "insufficient_credits" if the account cannot cover the cost.
              try {
                const capabilityRequest = JSON.stringify({
                  capability: "video-generation",
                  input: {
                    prompt,
                    model,
                    duration,
                    aspectRatio,
                    ...(config?.apiKey ? { apiKey: config.apiKey } : {}),
                  },
                });

                const raw = await pluginCtx.inject("__capability__", capabilityRequest, { silent: true });
                const result = parseSocketResponse(raw);

                if (result.error) {
                  pluginCtx.log.error("Video generation API error", result.error);
                  return {
                    content: [{ type: "text", text: "Video generation failed. Please try again." }],
                    isError: true,
                  };
                }

                return { content: [{ type: "text", text: result.url ?? "No URL returned" }] };
              } catch (error: unknown) {
                pluginCtx.log.error("Video generation error", error);
                return {
                  content: [{ type: "text", text: "Video generation failed. Please try again." }],
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
    // Uses wildcard "*" event to catch late-joining channel providers
    const unsubProviderEvent = ctx.events.on("*", async (payload) => {
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
    cleanups.push(unsubProviderEvent);

    ctx.log.info("VideoGen plugin initialized");
  },

  async shutdown() {
    if (!pluginCtx) return; // idempotent guard

    // Run all cleanup functions (event listeners, etc.)
    for (const fn of cleanups) fn();
    cleanups.length = 0;

    // Unregister /video command from all channel providers
    for (const providerId of registeredProviderIds) {
      const provider = pluginCtx.getChannelProvider(providerId);
      if (provider) {
        provider.unregisterCommand("video");
      }
    }
    registeredProviderIds.length = 0;

    // Unregister capability provider
    pluginCtx.unregisterCapabilityProvider("video-generation", "videogen-replicate");

    // Unregister config schema
    pluginCtx.unregisterConfigSchema("wopr-plugin-videogen");

    pluginCtx = null;
  },
};

export default plugin;
