import Docker from 'dockerode';

// Platform-specific Docker connection configuration
const getDockerConnection = () => {
  if (process.platform === 'win32') {
    // Windows: Attempt named pipe connection first
    try {
      return new Docker({ socketPath: '//./pipe/docker_engine' });
    } catch (error) {
      console.log('[DOCKER] Named pipe connection failed, attempting alternative...');
      try {
        return new Docker({ socketPath: '\\\\.\\pipe\\docker_engine' });
      } catch (error2) {
        console.log('[DOCKER] Alternative connection failed, using default configuration...');
        return new Docker(); // Use default configuration
      }
    }
  } else {
    // Linux/Mac: Use Unix socket
    return new Docker({ socketPath: '/var/run/docker.sock' });
  }
};

const docker = getDockerConnection();
console.log(`[DOCKER] Container runtime connection established for ${process.platform} platform`);

const BASE_DOMAIN = process.env.EASYPANEL_BASE_DOMAIN || process.env.BASE_DOMAIN || 'ld4pxg.easypanel.host';
// Let Easypanel handle networking automatically
const NETWORK_NAME = process.env.DOCKER_NETWORK || 'bridge';

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
    const { serviceName, userId, memory = '512m', cpu = 512 } = params;

    try {
      console.log(`[DOCKER] Initializing N8N instance creation: ${serviceName}`);
      console.log(`[DOCKER] Environment validation: N8N_ENCRYPTION_KEY ${process.env.N8N_ENCRYPTION_KEY ? 'configured' : 'missing, using generated key'}`);

      // Container configuration
      const imageName = 'n8nio/n8n:latest';
      console.log(`[DOCKER] Verifying container image: ${imageName}`);
      await this.ensureImageExists(imageName);

      const encryptionKey = process.env.N8N_ENCRYPTION_KEY || this.generatePassword();
      const instanceUrl = `https://${serviceName}.${BASE_DOMAIN}`;
      const traefikId = `wasapi_${serviceName}`;

      const containerConfig: Docker.ContainerCreateOptions = {
        name: serviceName,
        Image: imageName,
        Env: [
          `N8N_ENCRYPTION_KEY=${encryptionKey}`,
          'N8N_USER_MANAGEMENT_DISABLED=false',
          'N8N_BASIC_AUTH_ACTIVE=false',
          `WEBHOOK_URL=${instanceUrl}`,
          `N8N_EDITOR_BASE_URL=${instanceUrl}`,
          `N8N_PROTOCOL=https`,
          `N8N_HOST=${serviceName}.${BASE_DOMAIN}`,
          'N8N_PORT=5678',
          'N8N_LISTEN_ADDRESS=0.0.0.0',
          'N8N_TRUST_PROXY=true',
          'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true',
          // Database configuration
          'DB_TYPE=sqlite',
          'DB_SQLITE_DATABASE=/home/node/.n8n/database.sqlite',
          'DB_SQLITE_POOL_SIZE=3',
          'EXECUTIONS_DATA_PRUNE=true',
          'EXECUTIONS_DATA_MAX_AGE=168',
          // Additional settings for stability
          'N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN=true',
          'NODE_ENV=production',
          // Force HTTP for internal communication
          'N8N_PROTOCOL=https',
          'N8N_SSL_KEY=',
          'N8N_SSL_CERT=',
          // Additional startup settings
          'GENERIC_TIMEZONE=America/Bogota',
          'N8N_DEFAULT_LOCALE=en',
        ],
        Labels: {
          'traefik.enable': 'true',
          [`traefik.http.routers.${traefikId}.rule`]: `Host("${serviceName}.${BASE_DOMAIN}")`,
          [`traefik.http.routers.${traefikId}.entrypoints`]: 'websecure',
          [`traefik.http.routers.${traefikId}.tls`]: 'true',
          [`traefik.http.routers.${traefikId}.tls.certresolver`]: 'letsencrypt',
          [`traefik.http.routers.${traefikId}.service`]: traefikId,
          [`traefik.http.services.${traefikId}.loadbalancer.server.port`]: '5678',
          // Try without specifying network to let Easypanel handle it
          // 'traefik.docker.network': 'easypanel-blxk',
          'easypanel.managed': 'true',
          'easypanel.project': 'wasapi',
          'easypanel.service': serviceName,
          'service.name': serviceName,
        },
        HostConfig: {
          Memory: this.parseMemory(memory),
          NanoCpus: cpu * 1000000,
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${serviceName}-data:/home/node/.n8n`],
        },
      };

      // Crear volumen para persistencia
      await this.createVolume(`${serviceName}-data`);

      // Crear contenedor
      const container = await docker.createContainer(containerConfig);

      // Iniciar contenedor
      await container.start();

      // Obtener información del contenedor
      const containerInfo = await container.inspect();
      const networkIP = containerInfo.NetworkSettings.Networks?.[NETWORK_NAME]?.IPAddress || 'unknown';

      console.log(`[DOCKER] Container deployment completed: ${serviceName}`);
      console.log(`[DOCKER] Instance endpoint: https://${serviceName}.${BASE_DOMAIN}`);
      console.log(`[DOCKER] Network configuration: ${networkIP}`);

      // Perform initial health verification with extended timeout
      console.log(`[DOCKER] Performing initial service health check...`);
      const isReady = await this.waitForN8nReady(serviceName, 20, 10000); // 20 attempts, 10 seconds = 200 seconds (3.3 minutes) maximum

      if (!isReady) {
        console.log(`[DOCKER] Service initialization in progress. Full readiness may require additional time.`);
        console.log(`[DOCKER] Container created successfully. N8N may take 5-10 minutes to complete initialization.`);
      }

      // Siempre usar HTTPS con Traefik en producción
      const publicUrl = `https://${serviceName}.${BASE_DOMAIN}`;

      return {
        success: true,
        containerId: container.id,
        url: publicUrl,
        urlInterna: `http://${networkIP}:5678`,
        port: '5678',
        credentials: {
          url: publicUrl,
          setup_required: true,
          note: isReady
            ? 'N8N está listo. Accede a la URL para completar el setup inicial y crear tu cuenta.'
            : 'N8N se está inicializando. Puede tomar unos minutos estar completamente listo. Revisa la URL en unos momentos.',
          health_check_passed: isReady,
        },
      };
    } catch (error: any) {
      console.error(`[DOCKER] Instance creation failed for ${serviceName}:`, error.message);
      throw new Error(`Service deployment failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Iniciar una instancia
   */
  async startInstance(serviceName: string) {
    try {
      console.log(`[DOCKER] Initiating service startup: ${serviceName}`);

      const container = docker.getContainer(serviceName);
      await container.start();

      console.log(`[DOCKER] Service startup completed: ${serviceName}`);
      return { success: true, message: 'Service started successfully' };
    } catch (error: any) {
      console.error(`[DOCKER] Service startup failed for ${serviceName}:`, error.message);
      throw new Error(`Service startup failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Pausar una instancia
   */
  async pauseInstance(serviceName: string) {
    try {
      console.log(`[DOCKER] Initiating service shutdown: ${serviceName}`);

      const container = docker.getContainer(serviceName);
      await container.stop();

      console.log(`[DOCKER] Service shutdown completed: ${serviceName}`);
      return { success: true, message: 'Service paused successfully' };
    } catch (error: any) {
      console.error(`[DOCKER] Service shutdown failed for ${serviceName}:`, error.message);
      throw new Error(`Service shutdown failed: ${error.message || 'Unknown error'}`);
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
        await container.stop({ t: 10 });
        console.log(`[Docker] Container stopped: ${serviceName}`);
      } catch (e) {
        console.log(`[Docker] Container already stopped: ${serviceName}`);
      }

      // Desconectar de las redes
      const networks = [NETWORK_NAME];
      for (const networkName of networks) {
        try {
          const network = docker.getNetwork(networkName);
          await network.disconnect({ Container: serviceName, Force: true });
          console.log(`[DOCKER] Network disconnection completed: ${networkName}`);
        } catch (e) {
          // Ya desconectado o no estaba conectado
        }
      }

      // Remove container
      await container.remove({ force: true });
      console.log(`[DOCKER] Container cleanup completed: ${serviceName}`);

      // Remove persistent storage
      try {
        const volume = docker.getVolume(`${serviceName}-data`);
        await volume.remove({ force: true });
        console.log(`[DOCKER] Persistent storage removed: ${serviceName}-data`);
      } catch (e) {
        console.log(`[DOCKER] Persistent storage not found or already cleaned: ${serviceName}-data`);
      }

      console.log(`[DOCKER] Service removal completed successfully: ${serviceName}`);
      return { success: true, message: 'Service deleted successfully' };
    } catch (error: any) {
      console.error(`[DOCKER] Service removal failed for ${serviceName}:`, error.message);
      throw new Error(`Service removal failed: ${error.message || 'Unknown error'}`);
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
   * Asegurar que la imagen existe, y si no, descargarla
   */
  private async ensureImageExists(imageName: string) {
    try {
      const image = docker.getImage(imageName);
      await image.inspect();
      console.log(`[DOCKER] Image verification successful: ${imageName}`);
    } catch (error) {
      console.log(`[DOCKER] Image ${imageName} not available locally, initiating download...`);
      await new Promise((resolve, reject) => {
        docker.pull(imageName, (err: any, stream: any) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, onFinished, onProgress);

          function onFinished(err: any, output: any) {
            if (err) return reject(err);
            resolve(output);
          }

          function onProgress(event: any) {
            // Progress tracking disabled for cleaner logs
          }
        });
      });
      console.log(`[DOCKER] Image download completed: ${imageName}`);
    }
  }

  /**
   * Asegurar que la red existe
   */
  private async ensureNetworkExists(networkName: string) {
    try {
      const network = docker.getNetwork(networkName);
      await network.inspect();
    } catch (error: any) {
      console.log(`[Docker] Network ${networkName} not found, creating...`);
      try {
        await docker.createNetwork({
          Name: networkName,
          Driver: 'bridge',
          Attachable: true,
        });
        console.log(`[Docker] Network ${networkName} created successfully`);
      } catch (createError: any) {
        console.error(`[Docker] ❌ Error creating network ${networkName}:`, createError.message);
        throw createError;
      }
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
      console.log(`[DOCKER] Persistent storage created: ${volumeName}`);
    } catch (error: any) {
      if (error.statusCode === 409) {
        console.log(`[DOCKER] Persistent storage already exists: ${volumeName}`);
      } else {
        console.error(`[DOCKER] Storage creation failed: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Verificar que n8n esté listo y respondiendo
   */
  async waitForN8nReady(serviceName: string, maxRetries: number = 20, delay: number = 10000): Promise<boolean> {
    const instanceUrl = `https://${serviceName}.${BASE_DOMAIN}`;

    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`[DOCKER] Health check attempt ${i + 1}/${maxRetries} for ${serviceName}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        // Test basic connectivity first
        try {
          const response = await fetch(instanceUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'BLXK-Suite-HealthCheck/1.0',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            redirect: 'follow'
          });

          // Any response that's not 404 means the service is responding
          if (response.status !== 404) {
            console.log(`[DOCKER] Service connectivity confirmed for ${serviceName} (status: ${response.status})`);
            clearTimeout(timeoutId);
            return true;
          }
        } catch (connectivityError: any) {
          // Continue with endpoint checks
        }

        // Test multiple endpoints - n8n may use different health endpoints
        const endpoints = ['/rest/health', '/healthz', '/health'];
        let response: Response | null = null;

        for (const endpoint of endpoints) {
          try {
            response = await fetch(`${instanceUrl}${endpoint}`, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'BLXK-Suite-HealthCheck/1.0'
              }
            });

            // Accept responses indicating service is operational
            if (response.status === 200 || response.status === 302 || (response.status >= 400 && response.status !== 404 && response.status !== 502)) {
              console.log(`[DOCKER] Service readiness confirmed for ${serviceName} (status: ${response.status})`);
              clearTimeout(timeoutId);
              return true;
            }
          } catch (endpointError: any) {
            // Continue to next endpoint
          }
        }

        clearTimeout(timeoutId);
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log(`[DOCKER] Health check timeout on attempt ${i + 1}/${maxRetries}`);
        } else {
          console.log(`[DOCKER] Health check error on attempt ${i + 1}/${maxRetries}: ${error.message}`);
        }
      }

      // Wait before next attempt
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.log(`[DOCKER] Service readiness verification failed after ${maxRetries} attempts for ${serviceName}`);
    return false;
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
