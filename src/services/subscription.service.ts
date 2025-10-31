import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PlanType, UserSubscription, InstanceUsage } from '../types/plans.types';
import plansService from './plans.service';
import dotenv from 'dotenv';

// Asegurar que dotenv esté cargado
dotenv.config();

/**
 * Servicio para gestionar las suscripciones de usuarios
 */
export class SubscriptionService {
  private supabase: SupabaseClient;

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
   * Obtener la suscripción activa de un usuario (con información del plan)
   */
  async getUserSubscription(userId: string): Promise<UserSubscription | null> {
    try {
      const { data, error} = await this.supabase
        .from('v_user_subscriptions_full')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No se encontró suscripción
          return null;
        }
        throw error;
      }

      return {
        userId: data.user_id,
        planType: data.plan_type as PlanType,
        instanceName: data.instance_name,
        instanceUrl: data.instance_url,
        createdAt: new Date(data.created_at),
        expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
        isActive: data.is_active,
        currentWorkflows: data.current_workflows || 0,
        currentExecutions: data.current_executions || 0,
      };
    } catch (error: any) {
      console.error('[Subscription] Error getting user subscription:', error);
      throw error;
    }
  }

  /**
   * Crear una nueva suscripción para un usuario
   */
  async createSubscription(
    userId: string,
    planType: PlanType,
    instanceName?: string,
    instanceUrl?: string
  ): Promise<UserSubscription> {
    try {
      // Verificar que el plan existe y obtener su ID
      const planExists = await plansService.planExists(planType);
      if (!planExists) {
        throw new Error('Invalid plan type');
      }

      // Obtener el plan_id desde la tabla plans
      const { data: planData, error: planError } = await this.supabase
        .from('plans')
        .select('id')
        .eq('plan_type', planType)
        .eq('is_active', true)
        .single();

      if (planError || !planData) {
        throw new Error('Plan not found in database');
      }

      // Verificar si ya tiene una suscripción activa
      const existingSubscription = await this.getUserSubscription(userId);
      if (existingSubscription) {
        throw new Error('User already has an active subscription');
      }

      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          plan_id: planData.id,
          instance_name: instanceName,
          instance_url: instanceUrl,
          is_active: true,
          current_workflows: 0,
          current_executions: 0,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return {
        userId: data.user_id,
        planType: planType,
        instanceName: data.instance_name,
        instanceUrl: data.instance_url,
        createdAt: new Date(data.created_at),
        expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
        isActive: data.is_active,
        currentWorkflows: data.current_workflows || 0,
        currentExecutions: data.current_executions || 0,
      };
    } catch (error: any) {
      console.error('[Subscription] Error creating subscription:', error);
      throw error;
    }
  }

  /**
   * Actualizar información de la instancia en la suscripción
   */
  async updateInstanceInfo(
    userId: string,
    instanceName: string,
    instanceUrl: string
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('user_subscriptions')
        .update({
          instance_name: instanceName,
          instance_url: instanceUrl,
        })
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        throw error;
      }
    } catch (error: any) {
      console.error('[Subscription] Error updating instance info:', error);
      throw error;
    }
  }

  /**
   * Actualizar el uso de workflows
   */
  async updateWorkflowCount(userId: string, count: number): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('user_subscriptions')
        .update({
          current_workflows: count,
        })
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        throw error;
      }
    } catch (error: any) {
      console.error('[Subscription] Error updating workflow count:', error);
      throw error;
    }
  }

  /**
   * Incrementar el contador de ejecuciones
   */
  async incrementExecutionCount(userId: string): Promise<void> {
    try {
      const { error } = await this.supabase.rpc('increment_executions', {
        p_user_id: userId,
      });

      if (error) {
        throw error;
      }
    } catch (error: any) {
      console.error('[Subscription] Error incrementing execution count:', error);
      throw error;
    }
  }

  /**
   * Resetear el contador de ejecuciones (para inicio de mes)
   */
  async resetExecutionCount(userId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('user_subscriptions')
        .update({
          current_executions: 0,
        })
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        throw error;
      }
    } catch (error: any) {
      console.error('[Subscription] Error resetting execution count:', error);
      throw error;
    }
  }

  /**
   * Validar si el usuario puede crear un workflow
   */
  async canCreateWorkflow(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const subscription = await this.getUserSubscription(userId);

      if (!subscription) {
        return { allowed: false, reason: 'No active subscription found' };
      }

      const canCreate = await plansService.canCreateWorkflow(
        subscription.planType,
        subscription.currentWorkflows
      );

      if (!canCreate) {
        const plan = await plansService.getPlan(subscription.planType);
        return {
          allowed: false,
          reason: `Workflow limit reached (${subscription.currentWorkflows}/${plan?.limits.maxWorkflows})`,
        };
      }

      return { allowed: true };
    } catch (error: any) {
      console.error('[Subscription] Error checking workflow creation:', error);
      throw error;
    }
  }

  /**
   * Validar si el usuario puede ejecutar un workflow
   */
  async canExecuteWorkflow(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const subscription = await this.getUserSubscription(userId);

      if (!subscription) {
        return { allowed: false, reason: 'No active subscription found' };
      }

      const canExecute = await plansService.canExecuteWorkflow(
        subscription.planType,
        subscription.currentExecutions
      );

      if (!canExecute) {
        const plan = await plansService.getPlan(subscription.planType);
        return {
          allowed: false,
          reason: `Execution limit reached (${subscription.currentExecutions}/${plan?.limits.maxExecutions})`,
        };
      }

      return { allowed: true };
    } catch (error: any) {
      console.error('[Subscription] Error checking workflow execution:', error);
      throw error;
    }
  }

  /**
   * Obtener el uso actual del usuario
   */
  async getUsage(userId: string): Promise<InstanceUsage | null> {
    try {
      const subscription = await this.getUserSubscription(userId);

      if (!subscription) {
        return null;
      }

      return {
        workflows: subscription.currentWorkflows,
        executions: subscription.currentExecutions,
        lastUpdated: new Date(),
      };
    } catch (error: any) {
      console.error('[Subscription] Error getting usage:', error);
      throw error;
    }
  }

  /**
   * Cancelar suscripción
   */
  async cancelSubscription(userId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('user_subscriptions')
        .update({
          is_active: false,
        })
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        throw error;
      }
    } catch (error: any) {
      console.error('[Subscription] Error canceling subscription:', error);
      throw error;
    }
  }

  /**
   * Cambiar plan de suscripción
   */
  async changePlan(userId: string, newPlanType: PlanType): Promise<void> {
    try {
      // Verificar que el plan existe
      if (!plansService.planExists(newPlanType)) {
        throw new Error('Invalid plan type');
      }

      const { error } = await this.supabase
        .from('user_subscriptions')
        .update({
          plan_type: newPlanType,
        })
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        throw error;
      }
    } catch (error: any) {
      console.error('[Subscription] Error changing plan:', error);
      throw error;
    }
  }
}

export default new SubscriptionService();
