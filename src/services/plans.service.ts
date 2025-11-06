import { Plan, PlanType, PlanLimits } from '../types/plans.types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Asegurar que dotenv esté cargado
dotenv.config();

/**
 * Servicio para gestionar los planes de suscripción desde la base de datos
 */
export class PlansService {
  private supabase: SupabaseClient;
  private plansCache: Map<string, Plan> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    // Aceptar ambos nombres: SUPABASE_SERVICE_KEY o SERVICE_ROLE_KEY
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SERVICE_ROLE_KEY) must be set in environment variables');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Cargar planes desde la base de datos
   */
  private async loadPlansFromDB(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('plans')
        .select('*')
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      // Limpiar cache
      this.plansCache.clear();

      // Cargar planes en cache
      data?.forEach((planData: any) => {
        const plan: Plan = {
          type: planData.plan_type as PlanType,
          name: planData.name,
          limits: {
            ram: planData.ram,
            cpu: planData.cpu,
            maxWorkflows: planData.max_workflows,
            maxExecutions: planData.max_executions,
            price: parseFloat(planData.price),
          },
        };
        this.plansCache.set(planData.plan_type, plan);
      });

      this.cacheExpiry = Date.now() + this.CACHE_DURATION;
    } catch (error: any) {
      console.error('[PlansService] Error loading plans from DB:', error);
      throw error;
    }
  }

  /**
   * Verificar si el cache está expirado
   */
  private isCacheExpired(): boolean {
    return Date.now() > this.cacheExpiry || this.plansCache.size === 0;
  }

  /**
   * Obtener planes (con cache)
   */
  private async ensurePlansLoaded(): Promise<void> {
    if (this.isCacheExpired()) {
      await this.loadPlansFromDB();
    }
  }

  /**
   * Obtener un plan por su tipo
   */
  async getPlan(planType: PlanType): Promise<Plan | undefined> {
    await this.ensurePlansLoaded();
    return this.plansCache.get(planType);
  }

  /**
   * Obtener todos los planes disponibles
   */
  async getAllPlans(): Promise<Plan[]> {
    await this.ensurePlansLoaded();
    return Array.from(this.plansCache.values());
  }

  /**
   * Obtener los límites de un plan
   */
  async getPlanLimits(planType: PlanType): Promise<PlanLimits | undefined> {
    await this.ensurePlansLoaded();
    const plan = this.plansCache.get(planType);
    return plan?.limits;
  }

  /**
   * Verificar si un plan existe
   */
  async planExists(planType: PlanType): Promise<boolean> {
    await this.ensurePlansLoaded();
    return this.plansCache.has(planType);
  }

  /**
   * Validar si el uso actual está dentro de los límites del plan
   */
  async validateUsage(planType: PlanType, currentWorkflows: number, currentExecutions: number): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    await this.ensurePlansLoaded();
    const plan = this.plansCache.get(planType);
    
    if (!plan) {
      return {
        valid: false,
        errors: ['Plan not found'],
      };
    }

    const errors: string[] = [];

    // Validar workflows (si no es ilimitado)
    if (plan.limits.maxWorkflows !== -1 && currentWorkflows > plan.limits.maxWorkflows) {
      errors.push(
        `Workflow limit exceeded: ${currentWorkflows}/${plan.limits.maxWorkflows}`
      );
    }

    // Validar ejecuciones (si no es ilimitado)
    if (plan.limits.maxExecutions !== -1 && currentExecutions > plan.limits.maxExecutions) {
      errors.push(
        `Execution limit exceeded: ${currentExecutions}/${plan.limits.maxExecutions}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Verificar si se puede crear un nuevo workflow
   */
  async canCreateWorkflow(planType: PlanType, currentWorkflows: number): Promise<boolean> {
    await this.ensurePlansLoaded();
    const plan = this.plansCache.get(planType);
    
    if (!plan) {
      return false;
    }

    // Si es ilimitado, siempre puede crear
    if (plan.limits.maxWorkflows === -1) {
      return true;
    }

    return currentWorkflows < plan.limits.maxWorkflows;
  }

  /**
   * Verificar si se puede ejecutar un workflow
   */
  async canExecuteWorkflow(planType: PlanType, currentExecutions: number): Promise<boolean> {
    await this.ensurePlansLoaded();
    const plan = this.plansCache.get(planType);
    
    if (!plan) {
      return false;
    }

    // Si es ilimitado, siempre puede ejecutar
    if (plan.limits.maxExecutions === -1) {
      return true;
    }

    return currentExecutions < plan.limits.maxExecutions;
  }

  /**
   * Obtener el porcentaje de uso de workflows
   */
  async getWorkflowUsagePercentage(planType: PlanType, currentWorkflows: number): Promise<number> {
    await this.ensurePlansLoaded();
    const plan = this.plansCache.get(planType);
    
    if (!plan || plan.limits.maxWorkflows === -1) {
      return 0; // Ilimitado
    }

    return (currentWorkflows / plan.limits.maxWorkflows) * 100;
  }

  /**
   * Obtener el porcentaje de uso de ejecuciones
   */
  async getExecutionUsagePercentage(planType: PlanType, currentExecutions: number): Promise<number> {
    await this.ensurePlansLoaded();
    const plan = this.plansCache.get(planType);
    
    if (!plan || plan.limits.maxExecutions === -1) {
      return 0; // Ilimitado
    }

    return (currentExecutions / plan.limits.maxExecutions) * 100;
  }
}

export default new PlansService();
