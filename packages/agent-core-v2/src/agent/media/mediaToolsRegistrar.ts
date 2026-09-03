import { toDisposable, type IDisposable } from '#/_base/di/lifecycle';
import { Service } from '#/_base/di/service';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { defineState } from '#/state/state';
import { IAgentStateService } from '#/agent/state/agentState';
import { IEventBus } from '#/app/event/eventBus';
import { AgentStatusUpdated } from '#/agent/usage/usageEvents';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IFlagService } from '#/app/flag/flag';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import { type ModelRequester } from '#/kosong/model/modelRequester';
import { IProviderService } from '#/kosong/provider/provider';
import { IAgentRuntimeService } from '#/agent/runtimeBinding/agentRuntime';
import { ISessionSkillCatalog } from '#/features/skill/session/skillCatalog';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { extendWorkspaceWithSkillRoots } from '#/tool/path-access';

import { IAgentMediaToolsRegistrar } from './mediaTools';
import { VIDEO_MEDIA_FALLBACK_FLAG_ID } from './flag';
import { createVideoAnalyzer, createVideoUploader, registerMediaTools } from './registerMediaTools';

export const mediaRegisteredKeyKey = defineState<string | undefined>(
  'media.registeredKey',
  () => undefined as string | undefined,
);

export class AgentMediaToolsRegistrar extends Service implements IAgentMediaToolsRegistrar {
  declare readonly _serviceBrand: undefined;

  private registration: IDisposable | undefined;

  constructor(
    @IAgentToolRegistryService private readonly toolRegistry: IAgentToolRegistryService,
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IModelCatalog private readonly modelCatalog: IModelCatalog,
    @IProviderService private readonly providerService: IProviderService,
    @IFlagService private readonly flags: IFlagService,
    @IEventBus eventBus: IEventBus,
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ITelemetryService private readonly telemetry: ITelemetryService,
    @IAgentStateService private readonly states: IAgentStateService,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {
    super();
    this.states.contributeState(mediaRegisteredKeyKey);
    this.refresh();
    this._register(eventBus.subscribe(AgentStatusUpdated, () => this.refresh()));
    this._register(this.providerService.onDidChangeProviders(() => this.refresh()));
    this._register(this.runtime.onDidChange(() => this.refresh()));
    this._register(toDisposable(() => this.registration?.dispose()));
  }

  private get registeredKey(): string | undefined {
    return this.states.get(mediaRegisteredKeyKey);
  }

  private set registeredKey(value: string | undefined) {
    this.states.set(mediaRegisteredKeyKey, value);
  }

  private refresh(): void {
    const capabilities = this.profile.getModelCapabilities();
    const fallback = this.fallbackConfig();
    const modelAlias = this.profile.getModel();
    if (!this.runtime.isAvailable(['fs'])) {
      const key = [
        modelAlias,
        String(capabilities.image_in),
        String(capabilities.video_in),
        'runtime-unavailable',
      ].join('|');
      if (key === this.registeredKey) return;
      this.registeredKey = key;
      this.registration?.dispose();
      this.registration = undefined;
      return;
    }
    const inspected = this.runtime.inspect();
    const identityKey = [
      inspected.identity.workspaceId,
      inspected.identity.runtimeId,
      inspected.identity.generation,
    ].join('|');
    const key = [
      modelAlias,
      String(capabilities.image_in),
      String(capabilities.video_in),
      fallback?.model ?? '',
      fallback?.effort ?? '',
      identityKey,
      inspected.status,
      inspected.environment.pathClass,
      String(inspected.capabilities.has('fs')),
    ].join('|');
    if (key === this.registeredKey) return;
    this.registeredKey = key;
    this.registration?.dispose();
    const workspaceCtx = this.workspaceCtx;
    const skillCatalog = this.skillCatalog;
    const runtime = this.runtime;
    const pathClass = inspected.environment.pathClass;
    let requester: ModelRequester | undefined;
    let model: Model | undefined;
    if (modelAlias !== '') {
      try {
        requester = this.modelCatalog.getRequester(modelAlias);
        model = requester.model;
      } catch {
        requester = undefined;
        model = undefined;
      }
    }
    const fallbackRequester =
      fallback === undefined ? undefined : this.modelCatalog.getRequester(fallback.model);
    this.registration = registerMediaTools(this.toolRegistry, {
      runtime,
      workspace: {
        get workspaceDir() {
          return workspaceCtx.workDir;
        },
        get additionalDirs() {
          return extendWorkspaceWithSkillRoots(
            { workspaceDir: workspaceCtx.workDir, additionalDirs: workspaceCtx.additionalDirs },
            skillCatalog?.catalog.getSkillRoots() ?? [],
            pathClass,
          ).additionalDirs;
        },
      },
      capabilities,
      videoUploader: createVideoUploader(requester, {
        client: this.telemetry,
        props: {
          model: modelAlias,
          provider_type: model?.providerType ?? model?.protocol,
          protocol: model?.protocol,
        },
      }),
      inlineVideoSupported: model?.protocol !== 'openai' && model?.protocol !== 'openai_responses',
      videoAnalyzer:
        fallback === undefined
          ? undefined
          : createVideoAnalyzer(fallbackRequester, fallback.model, fallback.effort),
      telemetry: this.telemetry,
    });
  }

  private fallbackConfig(): { readonly model: string; readonly effort: string } | undefined {
    if (!this.flags.enabled(VIDEO_MEDIA_FALLBACK_FLAG_ID)) return undefined;
    const modelAlias = this.profile.getModel();
    if (modelAlias === '') return undefined;
    let model: Model;
    try {
      model = this.modelCatalog.getRequester(modelAlias).model;
    } catch {
      return undefined;
    }
    const provider = this.providerService.get(model.providerName);
    const fallbackModel = provider?.videoFallbackModel;
    if (fallbackModel === undefined || fallbackModel.length === 0) return undefined;
    return { model: fallbackModel, effort: provider?.videoFallbackEffort ?? 'high' };
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentMediaToolsRegistrar,
  AgentMediaToolsRegistrar,
  ScopeActivation.OnScopeCreated,
  'media',
);
