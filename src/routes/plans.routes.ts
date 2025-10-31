import { Router, Request, Response } from 'express';
import plansService from '../services/plans.service';
import subscriptionService from '../services/subscription.service';
import dockerService from '../services/docker.service';
import { PlanType } from '../types/plans.types';

const router = Router();

/**
 * Obtener todos los planes disponibles
 * GET /api/plans
 */
router.get('/plans', async (req: Request, res: Response) => {
  try {
    const plans = await plansService.getAllPlans();
    
    res.json({
      success: true,
      plans: plans.map(plan => ({
        type: plan.type,
        name: plan.name,
        price: plan.limits.price,
        limits: {
          ram: plan.limits.ram,
          cpu: plan.limits.cpu,
          maxWorkflows: plan.limits.maxWorkflows === -1 ? 'Unlimited' : plan.limits.maxWorkflows,
          maxExecutions: plan.limits.maxExecutions === -1 ? 'Unlimited' : plan.limits.maxExecutions,
        },
      })),
    });
  } catch (error: any) {
    console.error('[Plans] Error getting plans:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtener un plan específico
 * GET /api/plans/:planType
 */
router.get('/plans/:planType', async (req: Request, res: Response) => {
  try {
    const { planType } = req.params;
    
    const plan = await plansService.getPlan(planType as PlanType);
    
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({
      success: true,
      plan: {
        type: plan.type,
        name: plan.name,
        price: plan.limits.price,
        limits: {
          ram: plan.limits.ram,
          cpu: plan.limits.cpu,
          maxWorkflows: plan.limits.maxWorkflows === -1 ? 'Unlimited' : plan.limits.maxWorkflows,
          maxExecutions: plan.limits.maxExecutions === -1 ? 'Unlimited' : plan.limits.maxExecutions,
        },
      },
    });
  } catch (error: any) {
    console.error('[Plans] Error getting plan:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtener la suscripción del usuario
 * GET /api/subscription/:userId
 */
router.get('/subscription/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const subscription = await subscriptionService.getUserSubscription(userId);

    if (!subscription) {
      return res.status(404).json({ 
        error: 'No active subscription found',
        hasSubscription: false,
      });
    }

    const plan = await plansService.getPlan(subscription.planType);
    const workflowPercentage = await plansService.getWorkflowUsagePercentage(
      subscription.planType,
      subscription.currentWorkflows
    );
    const executionPercentage = await plansService.getExecutionUsagePercentage(
      subscription.planType,
      subscription.currentExecutions
    );

    res.json({
      success: true,
      hasSubscription: true,
      subscription: {
        planType: subscription.planType,
        planName: plan?.name,
        instanceName: subscription.instanceName,
        instanceUrl: subscription.instanceUrl,
        createdAt: subscription.createdAt,
        isActive: subscription.isActive,
        usage: {
          workflows: {
            current: subscription.currentWorkflows,
            limit: plan?.limits.maxWorkflows === -1 ? 'Unlimited' : plan?.limits.maxWorkflows,
            percentage: workflowPercentage,
          },
          executions: {
            current: subscription.currentExecutions,
            limit: plan?.limits.maxExecutions === -1 ? 'Unlimited' : plan?.limits.maxExecutions,
            percentage: executionPercentage,
          },
        },
      },
    });
  } catch (error: any) {
    console.error('[Subscription] Error getting subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Crear instancia n8n con plan Free (o cualquier plan)
 * POST /api/subscription/create-instance
 */
router.post('/subscription/create-instance', async (req: Request, res: Response) => {
  try {
    const { user_id, plan_type = 'Free', instance_name } = req.body;

    console.log('[Subscription] Creating instance:', { user_id, plan_type, instance_name });

    // Validaciones
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Verificar si el usuario ya tiene una suscripción activa
    const existingSubscription = await subscriptionService.getUserSubscription(user_id);
    if (existingSubscription) {
      return res.status(400).json({ 
        error: 'User already has an active subscription',
        subscription: {
          planType: existingSubscription.planType,
          instanceUrl: existingSubscription.instanceUrl,
        },
      });
    }

    // Validar que el plan existe
    const plan = await plansService.getPlan(plan_type as PlanType);
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    // Generar nombre de instancia si no se proporciona
    const serviceName = instance_name || `n8n-${user_id.substring(0, 8)}-${Date.now()}`;

    // Validar formato del nombre
    if (!/^[a-z0-9_-]+$/.test(serviceName)) {
      return res.status(400).json({ 
        error: 'Invalid instance name. Use only lowercase letters, numbers, hyphens and underscores' 
      });
    }

    // Verificar si el contenedor ya existe
    const exists = await dockerService.containerExists(serviceName);
    if (exists) {
      return res.status(400).json({ 
        error: 'An instance with this name already exists' 
      });
    }

    // Crear instancia con Docker usando los límites del plan
    console.log('[Subscription] Creating Docker instance with plan limits:', plan.limits);
    const dockerResult = await dockerService.createN8nInstance({
      serviceName: serviceName,
      userId: user_id,
      memory: plan.limits.ram,
      cpu: plan.limits.cpu,
    });

    // Crear suscripción en la base de datos
    const subscription = await subscriptionService.createSubscription(
      user_id,
      plan_type as PlanType,
      serviceName,
      dockerResult.url
    );

    // Guardar también en la tabla suites para compatibilidad
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY || ''
    );

    await supabase.from('suites').insert({
      user_id: user_id,
      name: serviceName,
      url: dockerResult.url,
      activo: true,
      credencials: dockerResult.credentials,
      product_name: 'n8n',
    });

    console.log('[Subscription] ✅ Instance created successfully:', serviceName);

    res.json({
      success: true,
      message: 'n8n instance created successfully',
      data: {
        subscription: {
          planType: subscription.planType,
          planName: plan.name,
          instanceName: subscription.instanceName,
          instanceUrl: subscription.instanceUrl,
        },
        instance: {
          url: dockerResult.url,
          credentials: dockerResult.credentials,
        },
        limits: {
          ram: plan.limits.ram,
          cpu: plan.limits.cpu,
          maxWorkflows: plan.limits.maxWorkflows === -1 ? 'Unlimited' : plan.limits.maxWorkflows,
          maxExecutions: plan.limits.maxExecutions === -1 ? 'Unlimited' : plan.limits.maxExecutions,
        },
      },
    });
  } catch (error: any) {
    console.error('[Subscription] ❌ Error creating instance:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create instance' 
    });
  }
});

/**
 * Actualizar contador de workflows
 * POST /api/subscription/update-workflows
 */
router.post('/subscription/update-workflows', async (req: Request, res: Response) => {
  try {
    const { user_id, workflow_count } = req.body;

    if (!user_id || workflow_count === undefined) {
      return res.status(400).json({ error: 'user_id and workflow_count are required' });
    }

    await subscriptionService.updateWorkflowCount(user_id, workflow_count);

    res.json({
      success: true,
      message: 'Workflow count updated successfully',
    });
  } catch (error: any) {
    console.error('[Subscription] Error updating workflow count:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Incrementar contador de ejecuciones
 * POST /api/subscription/increment-executions
 */
router.post('/subscription/increment-executions', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Verificar si puede ejecutar antes de incrementar
    const canExecute = await subscriptionService.canExecuteWorkflow(user_id);
    
    if (!canExecute.allowed) {
      return res.status(403).json({ 
        error: canExecute.reason,
        limitReached: true,
      });
    }

    await subscriptionService.incrementExecutionCount(user_id);

    res.json({
      success: true,
      message: 'Execution count incremented successfully',
    });
  } catch (error: any) {
    console.error('[Subscription] Error incrementing execution count:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtener uso actual del usuario
 * GET /api/subscription/usage/:userId
 */
router.get('/subscription/usage/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const usage = await subscriptionService.getUsage(userId);

    if (!usage) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    res.json({
      success: true,
      usage,
    });
  } catch (error: any) {
    console.error('[Subscription] Error getting usage:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Verificar si puede crear workflow
 * GET /api/subscription/can-create-workflow/:userId
 */
router.get('/subscription/can-create-workflow/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const result = await subscriptionService.canCreateWorkflow(userId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[Subscription] Error checking workflow creation:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cambiar plan de suscripción
 * POST /api/subscription/change-plan
 */
router.post('/subscription/change-plan', async (req: Request, res: Response) => {
  try {
    const { user_id, new_plan_type } = req.body;

    if (!user_id || !new_plan_type) {
      return res.status(400).json({ error: 'user_id and new_plan_type are required' });
    }

    // Validar que el plan existe
    const plan = await plansService.getPlan(new_plan_type as PlanType);
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    await subscriptionService.changePlan(user_id, new_plan_type as PlanType);

    res.json({
      success: true,
      message: 'Plan changed successfully',
      newPlan: {
        type: plan.type,
        name: plan.name,
        limits: plan.limits,
      },
    });
  } catch (error: any) {
    console.error('[Subscription] Error changing plan:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cancelar suscripción
 * POST /api/subscription/cancel
 */
router.post('/subscription/cancel', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    await subscriptionService.cancelSubscription(user_id);

    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error: any) {
    console.error('[Subscription] Error cancelling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
