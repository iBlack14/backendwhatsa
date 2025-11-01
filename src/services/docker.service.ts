import Docker from 'dockerode';

// Configuración para Windows (Docker Desktop)
const getDockerConnection = () => {
  if (process.platform === 'win32') {
    // Windows: Intentar con named pipe primero
    try {
      return new Docker({ socketPath: '//./pipe/docker_engine' });
    } catch (error) {
      console.warn('⚠️ Named pipe failed, trying npipe...');
      try {
        return new Docker({ socketPath: '\\\\.\\pipe\\docker_engine' });
      } catch (error2) {
        console.warn('⚠️ Npipe failed, using default...');
        return new Docker(); // Usa configuración por defecto
      }
    }
  } else {
    // Linux/Mac: usar socket Unix
    return new Docker({ socketPath: '/var/run/docker.sock' });
  }
};

const docker = getDockerConnection();
console.log('✅ Docker connection initialized for', process.platform);

const BASE_DOMAIN = process.env.EASYPANEL_BASE_DOMAIN || process.env.BASE_DOMAIN || 'qn0goj.easypanel.host';
const NETWORK_NAME = process.env.DOCKER_NETWORK || 'easypanel';

interface CreateN8nInstanceParams {
  serviceName: string;
  userId: string;
  memory?: string;
  cpu?: number;
}

export class DockerService {
  /**
   * Verificar si Docker está disponible
   */
  private checkDockerAvailable(): void {
    if (!docker) {
      throw new Error('Docker is not available. Please start Docker Desktop.');
    }
  }

  /**
   * Crear una nueva instancia de n8n usando Docker
   */
  async createN8nInstance(params: CreateN8nInstanceParams) {
    this.checkDockerAvailable();
    const { serviceName, userId, memory = '256m', cpu = 256 } = params;

    try {
      console.log(`[Docker] Creating n8n instance: ${serviceName}`);

      // Configuración del contenedor
      const containerConfig: Docker.ContainerCreateOptions = {
        name: serviceName,
        Image: 'n8nio/n8n:latest',
        Env: [
          `N8N_ENCRYPTION_KEY=${process.env.N8N_ENCRYPTION_KEY || this.generatePassword()}`,
          // Permitir que el usuario configure su propia cuenta en el setup inicial
          'N8N_USER_MANAGEMENT_DISABLED=false',
          // No usar autenticación básica - dejar que N8N maneje el setup
          'N8N_BASIC_AUTH_ACTIVE=false',
          `WEBHOOK_URL=https://${serviceName}.${BASE_DOMAIN}`,
        ],
        Labels: {
          // Labels de Traefik para que el proxy inverso encuentre el contenedor
          'traefik.enable': 'true',
          [`traefik.http.routers.${serviceName}.rule`]: `Host(\`${serviceName}.${BASE_DOMAIN}\`)`,
          [`traefik.http.routers.${serviceName}.entrypoints`]: 'websecure',
          [`traefik.http.routers.${serviceName}.tls`]: 'true',
          [`traefik.http.routers.${serviceName}.tls.certresolver`]: 'letsencrypt',
          [`traefik.http.services.${serviceName}.loadbalancer.server.port`]: '5678',
          [`traefik.http.services.${serviceName}.loadbalancer.server.scheme`]: 'http',
          'easypanel.managed': 'true',
          'easypanel.project': 'blxk',
          'service': serviceName,
          'managed_by': 'suite',
        },
        HostConfig: {
          Memory: this.parseMemory(memory),
          NanoCpus: cpu * 1000000, // CPU en nanocores
          RestartPolicy: {
            Name: 'unless-stopped',
          },
          Binds: [
            `${serviceName}-data:/home/node/.n8n`,
          ],
          // Siempre usar la red de Easypanel en producción
          NetworkMode: NETWORK_NAME,
          PortBindings: {
            '5678/tcp': [{ HostPort: '0' }] // Puerto aleatorio en desarrollo
          }
        },
        ExposedPorts: {
          '5678/tcp': {},
        },
      };

      // Crear volumen para persistencia
      await this.createVolume(`${serviceName}-data`);

      // Crear contenedor
      const container = await docker.createContainer(containerConfig);

      // Iniciar contenedor
      await container.start();

      // Conectar a las redes necesarias para Traefik
      const networks = [NETWORK_NAME, 'easypanel-blxk'];
      for (const networkName of networks) {
        try {
          const network = docker.getNetwork(networkName);
          await network.connect({
            Container: container.id,
          });
          console.log(`[Docker] ✅ Connected to network: ${networkName}`);
        } catch (netError: any) {
          if (netError.statusCode === 409 || netError.statusCode === 403) {
            console.log(`[Docker] ℹ️ Already connected to network: ${networkName}`);
          } else {
            console.warn(`[Docker] ⚠️ Could not connect to network ${networkName}:`, netError.message);
          }
        }
      }

      // Obtener información del contenedor para el puerto
      const containerInfo = await container.inspect();
      const port = containerInfo.NetworkSettings.Ports?.['5678/tcp']?.[0]?.HostPort || '5678';

      console.log(`[Docker] ✅ Instance created and started: ${serviceName}`);
      console.log(`[Docker] 📍 Port: ${port}`);
      console.log(`[Docker] 🌐 URL: https://${serviceName}.${BASE_DOMAIN}`);

      // En desarrollo, usar localhost con puerto
      const isDev = process.env.NODE_ENV !== 'production';
      const publicUrl = isDev 
        ? `http://localhost:${port}` 
        : `https://${serviceName}.${BASE_DOMAIN}`;

      return {
        success: true,
        containerId: container.id,
        url: publicUrl,
        urlInterna: `http://localhost:${port}`,
        port: port,
        credentials: {
          url: publicUrl,
          setup_required: true,
          note: 'Accede a la URL para completar el setup inicial de N8N y crear tu cuenta',
        },
      };
    } catch (error: any) {
      console.error('[Docker] ❌ Error creating instance:', error.message);
      throw new Error(error.message || 'Failed to create n8n instance');
    }
  }

  /**
   * Iniciar una instancia
   */
  async startInstance(serviceName: string) {
    try {
      console.log(`[Docker] Starting instance: ${serviceName}`);
      
      const container = docker.getContainer(serviceName);
      await container.start();

      console.log(`[Docker] ✅ Instance started: ${serviceName}`);
      return { success: true, message: 'Instance started successfully' };
    } catch (error: any) {
      console.error('[Docker] ❌ Error starting instance:', error.message);
      throw new Error(error.message || 'Failed to start instance');
    }
  }

  /**
   * Pausar una instancia
   */
  async pauseInstance(serviceName: string) {
    try {
      console.log(`[Docker] Pausing instance: ${serviceName}`);
      
      const container = docker.getContainer(serviceName);
      await container.stop();

      console.log(`[Docker] ✅ Instance paused: ${serviceName}`);
      return { success: true, message: 'Instance paused successfully' };
    } catch (error: any) {
      console.error('[Docker] ❌ Error pausing instance:', error.message);
      throw new Error(error.message || 'Failed to pause instance');
    }
  }

  /**
   * Eliminar una instancia
   */
  async deleteInstance(serviceName: string) {
    try {
      console.log(`[Docker] Deleting instance: ${serviceName}`);
      
      const container = docker.getContainer(serviceName);
      
      // Detener si está corriendo
      try {
        await container.stop();
      } catch (e) {
        // Ya está detenido
      }

      // Eliminar contenedor
      await container.remove();

      // Eliminar volumen
      try {
        const volume = docker.getVolume(`${serviceName}-data`);
        await volume.remove();
      } catch (e) {
        console.log('[Docker] Volume already removed or not found');
      }

      console.log(`[Docker] ✅ Instance deleted: ${serviceName}`);
      return { success: true, message: 'Instance deleted successfully' };
    } catch (error: any) {
      console.error('[Docker] ❌ Error deleting instance:', error.message);
      throw new Error(error.message || 'Failed to delete instance');
    }
  }

  /**
   * Obtener estado de una instancia
   */
  async getInstanceStatus(serviceName: string) {
    try {
      const container = docker.getContainer(serviceName);
      const info = await container.inspect();
      
      return {
        id: info.Id,
        name: info.Name,
        state: info.State.Status,
        running: info.State.Running,
        created: info.Created,
        image: info.Config.Image,
      };
    } catch (error: any) {
      console.error('[Docker] ❌ Error getting status:', error.message);
      throw new Error(error.message || 'Failed to get instance status');
    }
  }

  /**
   * Obtener métricas de uso de recursos
   */
  async getInstanceMetrics(serviceName: string) {
    try {
      const container = docker.getContainer(serviceName);
      const stats = await container.stats({ stream: false });
      
      return {
        cpu: this.calculateCpuPercent(stats),
        memory: {
          usage: stats.memory_stats.usage,
          limit: stats.memory_stats.limit,
          percent: (stats.memory_stats.usage / stats.memory_stats.limit) * 100,
        },
        network: stats.networks,
      };
    } catch (error: any) {
      console.error('[Docker] ❌ Error getting metrics:', error.message);
      throw new Error(error.message || 'Failed to get metrics');
    }
  }

  /**
   * Verificar si un contenedor existe
   */
  async containerExists(serviceName: string): Promise<boolean> {
    try {
      const container = docker.getContainer(serviceName);
      await container.inspect();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Crear volumen para persistencia
   */
  private async createVolume(volumeName: string) {
    try {
      await docker.createVolume({
        Name: volumeName,
        Labels: {
          'easypanel.managed': 'true',
        },
      });
      console.log(`[Docker] Volume created: ${volumeName}`);
    } catch (error: any) {
      if (error.statusCode === 409) {
        console.log(`[Docker] Volume already exists: ${volumeName}`);
      } else {
        throw error;
      }
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
   * Convertir memoria a bytes
   */
  private parseMemory(memory: string): number {
    const value = parseInt(memory);
    const unit = memory.replace(/[0-9]/g, '').toLowerCase();
    
    const multipliers: { [key: string]: number } = {
      'b': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024,
    };

    return value * (multipliers[unit] || multipliers['m']);
  }

  /**
   * Calcular porcentaje de CPU
   */
  private calculateCpuPercent(stats: any): number {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    
    return (cpuDelta / systemDelta) * cpuCount * 100;
  }
}

export default new DockerService();
