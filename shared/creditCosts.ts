export const CREDIT_COSTS = {
  cta: 1,
  headline: 1,
  caption: 2,
  full_post: 5,
  image_prompt: 10,
  variations: 10,
  image_ai: 15,
  image_ai_1k: 15,
  image_ai_2k: 25,
  image_ai_4k: 40,
  site_analysis: 20,
  strategy: 30,
  carousel: 30,
  seo_article: 35,
  video_script: 40,
  video_veo_fast: 50,
  video_veo_1080p: 100,
  video_veo_4k: 180,
  campaign: 50,
  autopilot_cycle: 5,
  auto_calendar: 100
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;
