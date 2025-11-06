export enum PlanType {
  FREE = 'Free',
  STARTER = 'Starter',
  PRO = 'Pro',
  BUSINESS = 'Business',
  ENTERPRISE = 'Enterprise',
}

export interface PlanLimits {
  ram: string; // e.g., "256M", "512M", "1G"
  cpu: number; // CPU millicores (256, 512, 1024, etc.)
  maxWorkflows: number; // Máximo de workflows
  maxExecutions: number; // Máximo de ejecuciones por mes
  price: number; // Precio en USD
}

export interface Plan {
  type: PlanType;
  name: string;
  limits: PlanLimits;
}

export interface UserSubscription {
  userId: string;
  planType: PlanType;
  instanceName?: string;
  instanceUrl?: string;
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  currentWorkflows: number;
  currentExecutions: number;
}

export interface CreateInstanceRequest {
  userId: string;
  planType: PlanType;
  instanceName?: string;
}

export interface InstanceUsage {
  workflows: number;
  executions: number;
  lastUpdated: Date;
}
