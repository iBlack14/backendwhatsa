import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export interface Proxy {
  id: string;
  name: string;
  type: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
  city?: string;
  is_active: boolean;
  is_healthy: boolean;
  last_health_check?: Date;
  health_check_error?: string;
  usage_count: number;
}

export interface InstanceProxy {
  id: string;
  instance_id: string;
  proxy_id?: string;
  rotation_enabled: boolean;
  rotation_interval_hours: number;
  last_rotation: Date;
  next_rotation?: Date;
}

/**
 * Servicio para gestionar proxies
 */
export class ProxyService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Obtener proxy asignado a una instancia
   */
  async getProxyForInstance(instanceId: string): Promise<Proxy | null> {
    try {
      const { data: instanceProxy, error: ipError } = await this.supabase
        .from('instance_proxies')
        .select('proxy_id')
        .eq('instance_id', instanceId)
        .single();

      if (ipError || !instanceProxy?.proxy_id) {
        return null;
      }

      const { data: proxy, error: pError } = await this.supabase
        .from('proxies')
        .select('*')
        .eq('id', instanceProxy.proxy_id)
        .single();

      if (pError) {
        console.error('Error fetching proxy:', pError);
        return null;
      }

      return proxy as Proxy;
    } catch (error) {
      console.error('Error getting proxy for instance:', error);
      return null;
    }
  }

  /**
   * Crear agente de proxy para Baileys
   */
  createProxyAgent(proxy: Proxy): any {
    const auth = proxy.username && proxy.password 
      ? `${proxy.username}:${proxy.password}@` 
      : '';
    
    const proxyUrl = `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;

    if (proxy.type === 'socks4' || proxy.type === 'socks5') {
      return new SocksProxyAgent(proxyUrl);
    } else {
      return new HttpsProxyAgent(proxyUrl);
    }
  }

  /**
   * Verificar salud del proxy
   */
  async healthCheck(proxyId: string): Promise<boolean> {
    try {
      const { data: proxy, error } = await this.supabase
        .from('proxies')
        .select('*')
        .eq('id', proxyId)
        .single();

      if (error || !proxy) {
        return false;
      }

      const agent = this.createProxyAgent(proxy as Proxy);
      
      // Test con una petición simple
      const response = await axios.get('https://api.ipify.org?format=json', {
        httpAgent: agent,
        httpsAgent: agent,
        timeout: 10000,
      });

      const isHealthy = response.status === 200;

      // Actualizar estado en DB
      await this.supabase
        .from('proxies')
        .update({
          is_healthy: isHealthy,
          last_health_check: new Date().toISOString(),
          health_check_error: isHealthy ? null : 'Connection failed',
        })
        .eq('id', proxyId);

      return isHealthy;
    } catch (error: any) {
      console.error(`Health check failed for proxy ${proxyId}:`, error.message);

      // Actualizar estado en DB
      await this.supabase
        .from('proxies')
        .update({
          is_healthy: false,
          last_health_check: new Date().toISOString(),
          health_check_error: error.message,
        })
        .eq('id', proxyId);

      return false;
    }
  }

  /**
   * Obtener proxy disponible (menos usado y saludable)
   */
  async getAvailableProxy(): Promise<Proxy | null> {
    try {
      const { data, error } = await this.supabase
        .from('proxies')
        .select('*')
        .eq('is_active', true)
        .eq('is_healthy', true)
        .order('usage_count', { ascending: true })
        .order('last_health_check', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.error('Error getting available proxy:', error);
        return null;
      }

      return data as Proxy;
    } catch (error) {
      console.error('Error getting available proxy:', error);
      return null;
    }
  }

  /**
   * Asignar proxy a instancia
   */
  async assignProxyToInstance(
    instanceId: string, 
    proxyId: string,
    rotationEnabled: boolean = false,
    rotationIntervalHours: number = 24
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('instance_proxies')
        .upsert({
          instance_id: instanceId,
          proxy_id: proxyId,
          rotation_enabled: rotationEnabled,
          rotation_interval_hours: rotationIntervalHours,
          last_rotation: new Date().toISOString(),
        });

      if (error) {
        console.error('Error assigning proxy:', error);
        return false;
      }

      // Incrementar contador de uso
      await this.supabase.rpc('increment', {
        table_name: 'proxies',
        row_id: proxyId,
        column_name: 'usage_count',
      });

      return true;
    } catch (error) {
      console.error('Error assigning proxy to instance:', error);
      return false;
    }
  }

  /**
   * Verificar si es necesario rotar proxy
   */
  async checkRotation(instanceId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('instance_proxies')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('rotation_enabled', true)
        .single();

      if (error || !data) {
        return false;
      }

      const instanceProxy = data as InstanceProxy;
      const now = new Date();
      const nextRotation = instanceProxy.next_rotation 
        ? new Date(instanceProxy.next_rotation) 
        : null;

      if (nextRotation && now >= nextRotation) {
        // Es hora de rotar
        const newProxy = await this.getAvailableProxy();
        if (newProxy && newProxy.id !== instanceProxy.proxy_id) {
          await this.assignProxyToInstance(
            instanceId,
            newProxy.id,
            instanceProxy.rotation_enabled,
            instanceProxy.rotation_interval_hours
          );
          console.log(`🔄 Proxy rotated for instance ${instanceId}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking rotation:', error);
      return false;
    }
  }
}

export const proxyService = new ProxyService();
