export interface OpenRouterOptions {
  reasoning?: {
    enabled?: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    max_tokens?: number;
    exclude?: boolean;
  };
  provider?: {
    only?: string[];
    order?: string[];
    ignore?: string[];
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
  };
}
