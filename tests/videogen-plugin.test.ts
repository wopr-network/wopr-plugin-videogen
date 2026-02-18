import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  A2AServerConfig,
  ChannelCommand,
  ChannelCommandContext,
  ChannelProvider,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

// Helper: create a mock WOPRPluginContext
function createMockContext() {
  const registeredCommands: Map<string, ChannelCommand> = new Map();
  const mockProvider: ChannelProvider = {
    id: "test-channel",
    registerCommand: vi.fn((cmd: ChannelCommand) => registeredCommands.set(cmd.name, cmd)),
    unregisterCommand: vi.fn((name: string) => registeredCommands.delete(name)),
    getCommands: vi.fn(() => Array.from(registeredCommands.values())),
    addMessageParser: vi.fn(),
    removeMessageParser: vi.fn(),
    getMessageParsers: vi.fn(() => []),
    send: vi.fn(),
    getBotUsername: vi.fn(() => "test-bot"),
  };

  const ctx: WOPRPluginContext = {
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn(),
    getConfig: vi.fn(() => ({
      provider: "replicate",
      model: "minimax-video",
      duration: "5",
      aspectRatio: "16:9",
    })),
    saveConfig: vi.fn(),
    getMainConfig: vi.fn(),
    getChannelProviders: vi.fn(() => [mockProvider]),
    getChannelProvider: vi.fn((id: string) => (id === "test-channel" ? mockProvider : undefined)),
    registerA2AServer: vi.fn(),
    inject: vi.fn(async (type: string) =>
      type === "__confirm__" ? "yes" : JSON.stringify({ url: "https://example.com/video.mp4" }),
    ),
    cancelInject: vi.fn(() => false),
    logMessage: vi.fn(),
    getAgentIdentity: vi.fn(async () => ({})),
    getUserProfile: vi.fn(async () => ({})),
    getSessions: vi.fn(() => []),
    events: {
      on: vi.fn(() => vi.fn()),
      once: vi.fn(() => vi.fn()),
      off: vi.fn(),
      emit: vi.fn(),
      emitCustom: vi.fn(),
    },
    hooks: {
      on: vi.fn(() => vi.fn()),
      off: vi.fn(),
      offByName: vi.fn(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    storage: {
      register: vi.fn(),
      getRepository: vi.fn(),
    },
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn(),
    listExtensions: vi.fn(() => []),
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    getContextProvider: vi.fn(),
    registerChannel: vi.fn(),
    unregisterChannel: vi.fn(),
    getChannel: vi.fn(),
    getChannels: vi.fn(() => []),
    getChannelsForSession: vi.fn(() => []),
    registerWebUiExtension: vi.fn(),
    unregisterWebUiExtension: vi.fn(),
    getWebUiExtensions: vi.fn(() => []),
    registerUiComponent: vi.fn(),
    unregisterUiComponent: vi.fn(),
    getUiComponents: vi.fn(() => []),
    registerLLMProvider: vi.fn(),
    unregisterLLMProvider: vi.fn(),
    getProvider: vi.fn(),
    registerSTTProvider: vi.fn(),
    registerTTSProvider: vi.fn(),
    getSTT: vi.fn(),
    getTTS: vi.fn(),
    hasVoice: vi.fn(() => ({ stt: false, tts: false })),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getPluginDir: vi.fn(() => "/tmp/test"),
  };

  return { ctx, mockProvider, registeredCommands };
}

describe("VideoGen Plugin", () => {
  it("exports a valid WOPRPlugin default export", async () => {
    const { default: plugin } = await import("../src/index.js");
    expect(plugin).toBeDefined();
    expect((plugin as WOPRPlugin).name).toBe("@wopr-network/wopr-plugin-videogen");
    expect((plugin as WOPRPlugin).version).toBe("1.0.0");
    expect(typeof (plugin as WOPRPlugin).init).toBe("function");
    expect(typeof (plugin as WOPRPlugin).shutdown).toBe("function");
  });

  it("has a valid manifest", async () => {
    const { default: plugin } = await import("../src/index.js");
    const p = plugin as WOPRPlugin;
    expect(p.manifest).toBeDefined();
    expect(p.manifest!.capabilities).toContain("video-generation");
    expect(p.manifest!.category).toBe("creative");
    expect(p.manifest!.provides?.capabilities).toHaveLength(1);
    expect(p.manifest!.provides?.capabilities[0].type).toBe("video-generation");
    expect(p.manifest!.provides?.capabilities[0].tier).toBe("byok");
    expect(p.manifest!.lifecycle?.shutdownBehavior).toBe("drain");
    expect(p.manifest!.lifecycle?.shutdownTimeoutMs).toBe(120_000);
  });

  it("registers config schema on init", async () => {
    const { default: plugin } = await import("../src/index.js");
    const p = plugin as WOPRPlugin;
    const { ctx } = createMockContext();
    await p.init!(ctx);
    expect(ctx.registerConfigSchema).toHaveBeenCalledWith("wopr-plugin-videogen", expect.any(Object));
    await p.shutdown!();
  });

  it("registers A2A tools on init", async () => {
    const { default: plugin } = await import("../src/index.js");
    const p = plugin as WOPRPlugin;
    const { ctx } = createMockContext();
    await p.init!(ctx);
    expect(ctx.registerA2AServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "videogen",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "generate_video" }),
          expect.objectContaining({ name: "list_video_models" }),
          expect.objectContaining({ name: "get_video_settings" }),
        ]),
      }),
    );
    await p.shutdown!();
  });

  it("registers /video command on channel providers", async () => {
    const { default: plugin } = await import("../src/index.js");
    const p = plugin as WOPRPlugin;
    const { ctx, mockProvider } = createMockContext();
    await p.init!(ctx);
    expect(mockProvider.registerCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: "video" }),
    );
    await p.shutdown!();
  });

  it("unregisters /video command on shutdown", async () => {
    const { default: plugin } = await import("../src/index.js");
    const p = plugin as WOPRPlugin;
    const { ctx, mockProvider } = createMockContext();
    await p.init!(ctx);
    await p.shutdown!();
    expect(mockProvider.unregisterCommand).toHaveBeenCalledWith("video");
  });
});

describe("VideoGen /video command handler", () => {
  let plugin: WOPRPlugin;
  let ctx: WOPRPluginContext;
  let registeredCommands: Map<string, ChannelCommand>;

  beforeEach(async () => {
    const mod = await import("../src/index.js");
    plugin = mod.default as WOPRPlugin;
    const mock = createMockContext();
    ctx = mock.ctx;
    registeredCommands = mock.registeredCommands;
    await plugin.init!(ctx);
  });

  async function invokeVideoCommand(args: string[]): Promise<string[]> {
    const videoCmd = registeredCommands.get("video");
    expect(videoCmd).toBeDefined();
    const replies: string[] = [];
    const cmdCtx: ChannelCommandContext = {
      channel: "test-channel-id",
      channelType: "test",
      sender: "test-user",
      args,
      reply: vi.fn(async (msg: string) => {
        replies.push(msg);
      }),
      getBotUsername: () => "test-bot",
    };
    await videoCmd!.handler(cmdCtx);
    return replies;
  }

  it("shows usage when no prompt provided", async () => {
    const replies = await invokeVideoCommand([]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("/video <prompt>");
  });

  it("shows settings when /video settings called", async () => {
    const replies = await invokeVideoCommand(["settings"]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Video Generation Settings");
    expect(replies[0]).toContain("replicate");
    expect(replies[0]).toContain("minimax-video");
  });

  it("shows models when /video models called", async () => {
    const replies = await invokeVideoCommand(["models"]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Available Video Models");
    expect(replies[0]).toContain("minimax-video");
    expect(replies[0]).toContain("wan-2.1");
  });

  it("generates video and returns URL when prompt provided", async () => {
    const replies = await invokeVideoCommand(["a", "cat", "dancing"]);
    // First reply is progress message (after confirmation)
    expect(replies[0]).toContain("Generating video");
    // Second reply is the video URL
    expect(replies[1]).toBe("https://example.com/video.mp4");
  });

  it("cancels video generation when user declines confirmation", async () => {
    (ctx.inject as ReturnType<typeof vi.fn>).mockResolvedValueOnce("no");
    const replies = await invokeVideoCommand(["a", "cat", "dancing"]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("cancelled");
  });

  it("passes prompt and default config to ctx.inject", async () => {
    await invokeVideoCommand(["a", "dog", "running"]);
    expect(ctx.inject).toHaveBeenCalledWith(
      "__capability__",
      expect.stringContaining("video-generation"),
      expect.any(Object),
    );
    // call[0] is the __confirm__ call, call[1] is the __capability__ call
    const callArgs = (ctx.inject as ReturnType<typeof vi.fn>).mock.calls[1];
    const payload = JSON.parse(callArgs[1] as string) as { capability: string; input: Record<string, unknown> };
    expect(payload.capability).toBe("video-generation");
    expect(payload.input.prompt).toBe("a dog running");
    expect(payload.input.model).toBe("minimax-video");
  });

  it("parses --model flag from command args", async () => {
    await invokeVideoCommand(["a", "cat", "--model", "wan-2.1"]);
    // call[0] is the __confirm__ call, call[1] is the __capability__ call
    const callArgs = (ctx.inject as ReturnType<typeof vi.fn>).mock.calls[1];
    const payload = JSON.parse(callArgs[1] as string) as { capability: string; input: Record<string, unknown> };
    expect(payload.input.model).toBe("wan-2.1");
    expect(payload.input.prompt).toBe("a cat");
  });

  it("parses --duration flag from command args", async () => {
    await invokeVideoCommand(["a", "bird", "--duration", "10"]);
    // call[0] is the __confirm__ call, call[1] is the __capability__ call
    const callArgs = (ctx.inject as ReturnType<typeof vi.fn>).mock.calls[1];
    const payload = JSON.parse(callArgs[1] as string) as { capability: string; input: Record<string, unknown> };
    expect(payload.input.duration).toBe(10);
  });

  it("parses --aspect flag from command args", async () => {
    await invokeVideoCommand(["a", "river", "--aspect", "9:16"]);
    // call[0] is the __confirm__ call, call[1] is the __capability__ call
    const callArgs = (ctx.inject as ReturnType<typeof vi.fn>).mock.calls[1];
    const payload = JSON.parse(callArgs[1] as string) as { capability: string; input: Record<string, unknown> };
    expect(payload.input.aspectRatio).toBe("9:16");
  });

  it("shows friendly message on insufficient_credits error", async () => {
    // First call is confirm (returns "yes"), second call is capability (returns error)
    (ctx.inject as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("yes")
      .mockResolvedValueOnce(JSON.stringify({ error: "insufficient_credits" }));
    const replies = await invokeVideoCommand(["test prompt"]);
    expect(replies[1]).toContain("credits");
  });

  it("handles plain-string URL response from socket", async () => {
    // First call is confirm (returns "yes"), second call is capability (returns URL)
    (ctx.inject as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("yes")
      .mockResolvedValueOnce("https://cdn.example.com/video.mp4");
    const replies = await invokeVideoCommand(["test prompt"]);
    expect(replies[1]).toBe("https://cdn.example.com/video.mp4");
  });

  it("handles generic error from socket", async () => {
    // First call is confirm (returns "yes"), second call is capability (returns error)
    (ctx.inject as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("yes")
      .mockResolvedValueOnce(JSON.stringify({ error: "model_unavailable" }));
    const replies = await invokeVideoCommand(["test prompt"]);
    expect(replies[1]).toContain("Video generation failed");
    // Raw error details should NOT be exposed to user (error sanitization)
    expect(replies[1]).not.toContain("model_unavailable");
  });
});

describe("VideoGen A2A tools", () => {
  let plugin: WOPRPlugin;
  let ctx: WOPRPluginContext;
  let a2aConfig: A2AServerConfig;

  beforeEach(async () => {
    const mod = await import("../src/index.js");
    plugin = mod.default as WOPRPlugin;
    const mock = createMockContext();
    ctx = mock.ctx;
    await plugin.init!(ctx);
    a2aConfig = (ctx.registerA2AServer as ReturnType<typeof vi.fn>).mock.calls[0][0] as A2AServerConfig;
  });

  function getTool(name: string) {
    return a2aConfig.tools.find((t) => t.name === name)!;
  }

  it("generate_video tool returns video URL", async () => {
    const tool = getTool("generate_video");
    const result = await tool.handler({ prompt: "a sunset" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("https://example.com/video.mp4");
  });

  it("generate_video tool returns error on failure", async () => {
    (ctx.inject as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ error: "quota_exceeded" }),
    );
    const tool = getTool("generate_video");
    const result = await tool.handler({ prompt: "a sunset" });
    expect(result.isError).toBe(true);
    // Raw error details should NOT be exposed (error sanitization)
    expect(result.content[0].text).toContain("Video generation failed");
    expect(result.content[0].text).not.toContain("quota_exceeded");
  });

  it("list_video_models returns model list as JSON", async () => {
    const tool = getTool("list_video_models");
    const result = await tool.handler({});
    expect(result.isError).toBeFalsy();
    const models = JSON.parse(result.content[0].text!) as Array<{ id: string }>;
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === "minimax-video")).toBe(true);
    expect(models.some((m) => m.id === "wan-2.1")).toBe(true);
  });

  it("get_video_settings returns current config", async () => {
    const tool = getTool("get_video_settings");
    const result = await tool.handler({});
    expect(result.isError).toBeFalsy();
    const settings = JSON.parse(result.content[0].text!) as Record<string, unknown>;
    expect(settings.provider).toBe("replicate");
    expect(settings.model).toBe("minimax-video");
    expect(settings.byokConfigured).toBe(false);
  });
});
