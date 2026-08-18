export interface PlanEntitlements {
  planId: string;
  planName: string;
  maxCompanies: number;
  autopilotManual: boolean;
  autopilotAutomatic: boolean;
  advancedSeo: boolean;
  campaigns: boolean;
  socialConnections: boolean;
}

export function getPlanEntitlements(planId?: string | null): PlanEntitlements {
  const pid = planId || 'plan_free';
  switch (pid) {
    case 'plan_agency':
      return {
        planId: 'plan_agency',
        planName: 'AGENCY',
        maxCompanies: Number.POSITIVE_INFINITY, // Empresas ilimitadas conforme especificação comercial oficial
        autopilotManual: true,
        autopilotAutomatic: true,
        advancedSeo: true,
        campaigns: true,
        socialConnections: true
      };
    case 'plan_business':
      return {
        planId: 'plan_business',
        planName: 'BUSINESS',
        maxCompanies: 15,
        autopilotManual: true,
        autopilotAutomatic: true,
        advancedSeo: true,
        campaigns: true,
        socialConnections: true
      };
    case 'plan_pro':
      return {
        planId: 'plan_pro',
        planName: 'PRO',
        maxCompanies: 5,
        autopilotManual: true,
        autopilotAutomatic: false,
        advancedSeo: true,
        campaigns: false,
        socialConnections: true
      };
    case 'plan_start':
      return {
        planId: 'plan_start',
        planName: 'START',
        maxCompanies: 2,
        autopilotManual: false,
        autopilotAutomatic: false,
        advancedSeo: false,
        campaigns: false,
        socialConnections: false
      };
    case 'plan_free':
    default:
      return {
        planId: 'plan_free',
        planName: 'FREE',
        maxCompanies: 1,
        autopilotManual: false,
        autopilotAutomatic: false,
        advancedSeo: false,
        campaigns: false,
        socialConnections: false
      };
  }
}
