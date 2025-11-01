import axios from 'axios';

const EASYPANEL_API_URL = process.env.EASYPANEL_API_URL || 'https://api.easypanel.io';
const EASYPANEL_API_TOKEN = process.env.EASYPANEL_API_KEY || process.env.EASYPANEL_API_TOKEN;
const PROJECT_NAME = process.env.EASYPANEL_PROJECT_ID || process.env.EASYPANEL_PROJECT_NAME || 'blxk';
const BASE_DOMAIN = process.env.EASYPANEL_BASE_DOMAIN || process.env.BASE_DOMAIN || 'qn0goj.easypanel.host';

interface CreateN8nInstanceParams {
  serviceName: string;
  userId: string;
  memory?: string;
  cpu?: number;
}

export class EasypanelService {
  private headers = {
    'Authorization': `Bearer ${EASYPANEL_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  /**
   * Crear una nueva instancia de n8n en Easypanel
   */
  async createN8nInstance(params: CreateN8nInstanceParams) {
    const { serviceName, userId, memory = '256M', cpu = 256 } = params;

    if (!EASYPANEL_API_TOKEN) {
      throw new Error('EASYPANEL_API_TOKEN is not configured');
    }

    if (!PROJECT_NAME) {
      throw new Error('EASYPANEL_PROJECT_NAME is not configured');
    }

    try {
      console.log(`[Easypanel] Creating n8n instance: ${serviceName}`);

      const password = this.generatePassword();
      const username = `user_${userId.substring(0, 8)}`;

      // Configuración del servicio n8n
      const serviceData = {
        name: serviceName,
        project: PROJECT_NAME,
        type: 'app',
        source: {
          type: 'image',
          image: process.env.N8N_IMAGE || 'n8nio/n8n:latest',
        },
        domains: [
          {
            host: `${serviceName}.${BASE_DOMAIN}`,
            port: 5678,
            https: true,
          }
        ],
        env: [
          {
            key: 'N8N_ENCRYPTION_KEY',
            value: process.env.N8N_ENCRYPTION_KEY || this.generatePassword(),
          },
          {
            key: 'N8N_USER_MANAGEMENT_DISABLED',
            value: 'false',
          },
          {
            key: 'N8N_BASIC_AUTH_ACTIVE',
            value: 'true',
          },
          {
            key: 'N8N_BASIC_AUTH_USER',
            value: username,
          },
          {
            key: 'N8N_BASIC_AUTH_PASSWORD',
            value: password,
          },
          {
            key: 'WEBHOOK_URL',
            value: `https://${serviceName}.${BASE_DOMAIN}`,
          },
        ],
        deploy: {
          replicas: 1,
          command: null,
          zeroDowntime: true,
        },
        resources: {
          reservations: {
            memory: memory,
            cpus: cpu.toString(),
          },
          limits: {
            memory: this.calculateMemoryLimit(memory),
            cpus: (cpu * 2).toString(),
          },
        },
        volumes: [
          {
            name: `${serviceName}-data`,
            mountPath: '/home/node/.n8n',
          }
        ],
        ports: [
          {
            published: 5678,
            target: 5678,
            protocol: 'tcp',
          }
        ],
      };

      const response = await axios.post(
        `${EASYPANEL_API_URL}/projects/${PROJECT_NAME}/services`,
        serviceData,
        { headers: this.headers }
      );

      console.log(`[Easypanel] ✅ Instance created: ${serviceName}`);

      return {
        success: true,
        service: response.data,
        url: `https://${serviceName}.${BASE_DOMAIN}`,
        urlInterna: `http://${serviceName}:5678`,
        credentials: {
          username: username,
          password: password,
          url: `https://${serviceName}.${BASE_DOMAIN}`,
        },
      };
    } catch (error: any) {
      console.error('[Easypanel] ❌ Error creating instance:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create n8n instance');
    }
  }

  /**
   * Iniciar una instancia
   */
  async startInstance(serviceName: string) {
    try {
      console.log(`[Easypanel] Starting instance: ${serviceName}`);
      
      await axios.post(
        `${EASYPANEL_API_URL}/projects/${PROJECT_NAME}/services/${serviceName}/start`,
        {},
        { headers: this.headers }
      );

      console.log(`[Easypanel] ✅ Instance started: ${serviceName}`);
      return { success: true, message: 'Instance started successfully' };
    } catch (error: any) {
      console.error('[Easypanel] ❌ Error starting instance:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to start instance');
    }
  }

  /**
   * Pausar una instancia
   */
  async pauseInstance(serviceName: string) {
    try {
      console.log(`[Easypanel] Pausing instance: ${serviceName}`);
      
      await axios.post(
        `${EASYPANEL_API_URL}/projects/${PROJECT_NAME}/services/${serviceName}/stop`,
        {},
        { headers: this.headers }
      );

      console.log(`[Easypanel] ✅ Instance paused: ${serviceName}`);
      return { success: true, message: 'Instance paused successfully' };
    } catch (error: any) {
      console.error('[Easypanel] ❌ Error pausing instance:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to pause instance');
    }
  }

  /**
   * Eliminar una instancia
   */
  async deleteInstance(serviceName: string) {
    try {
      console.log(`[Easypanel] Deleting instance: ${serviceName}`);
      
      await axios.delete(
        `${EASYPANEL_API_URL}/projects/${PROJECT_NAME}/services/${serviceName}`,
        { headers: this.headers }
      );

      console.log(`[Easypanel] ✅ Instance deleted: ${serviceName}`);
      return { success: true, message: 'Instance deleted successfully' };
    } catch (error: any) {
      console.error('[Easypanel] ❌ Error deleting instance:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to delete instance');
    }
  }

  /**
   * Obtener estado de una instancia
   */
  async getInstanceStatus(serviceName: string) {
    try {
      const response = await axios.get(
        `${EASYPANEL_API_URL}/projects/${PROJECT_NAME}/services/${serviceName}`,
        { headers: this.headers }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Easypanel] ❌ Error getting status:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to get instance status');
    }
  }

  /**
   * Obtener métricas de uso de recursos
   */
  async getInstanceMetrics(serviceName: string) {
    try {
      const response = await axios.get(
        `${EASYPANEL_API_URL}/projects/${PROJECT_NAME}/services/${serviceName}/metrics`,
        { headers: this.headers }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Easypanel] ❌ Error getting metrics:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to get metrics');
    }
  }

  /**
   * Verificar si un servicio existe
   */
  async serviceExists(serviceName: string): Promise<boolean> {
    try {
      await this.getInstanceStatus(serviceName);
      return true;
    } catch (error) {
      return false;
    }
  }

  // ========== Utilidades Privadas ==========

  /**
   * Generar contraseña segura
   */
  private generatePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Calcular límite de memoria (el doble de la reserva)
   */
  private calculateMemoryLimit(reservation: string): string {
    const value = parseInt(reservation);
    const unit = reservation.replace(/[0-9]/g, '');
    return `${value * 2}${unit}`;
  }
}

export default new EasypanelService();
