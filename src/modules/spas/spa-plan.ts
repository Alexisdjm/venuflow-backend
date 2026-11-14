export const SPA_PLAN_MONTHLY_USD = {
  BASIC: 30,
  PLUS: 45,
  DEMO: 0,
} as const;

export function monthlyPlanRevenue(plans: Array<string | null | undefined>) {
  return plans.reduce((total, plan) => {
    if (plan === 'BASIC' || plan === 'PLUS' || plan === 'DEMO') {
      return total + SPA_PLAN_MONTHLY_USD[plan];
    }
    return total;
  }, 0);
}
