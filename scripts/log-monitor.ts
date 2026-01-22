#!/usr/bin/env node

/**
 * Script de Monitoreo de Logs en Tiempo Real
 * Para desarrollo y debugging del backend BLXK
 */

import { spawn } from 'child_process';
import readline from 'readline';

// Función principal simplificada
function main(): void {
  console.log('🔍 BLXK Backend Log Monitor');
  console.log('Monitoreando logs en tiempo real...\n');
  
  // Iniciar proceso del backend
  const backendProcess = spawn('npm', ['run', 'dev'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true
  });
  
  // Configurar readline para entrada interactiva
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'log-monitor> '
  });
  
  // Manejar stdout del backend
  backendProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter((line: string) => line.trim());
    lines.forEach((line: string) => {
      console.log(`[BACKEND] ${line}`);
    });
  });
  
  // Manejar stderr del backend
  backendProcess.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter((line: string) => line.trim());
    lines.forEach((line: string) => {
      console.log(`[ERROR] ${line}`);
    });
  });
  
  // Manejar comandos interactivos
  rl.on('line', (input: string) => {
    const [command, ...args] = input.trim().split(' ');
    
    switch (command) {
      case 'help':
        console.log('\n🔧 COMANDOS DISPONIBLES:');
        console.log('help - Mostrar esta ayuda');
        console.log('exit - Salir');
        console.log('stats - Mostrar estadísticas básicas');
        console.log('');
        break;
        
      case 'stats':
        console.log('\n📊 ESTADÍSTICAS BÁSICAS');
        console.log('⏱️  Tiempo de ejecución: Activo');
        console.log('📈 Logs procesados: Activo');
        console.log('');
        break;
        
      case 'exit':
        backendProcess.kill();
        rl.close();
        process.exit(0);
        break;
        
      default:
        if (command) {
          console.log(`❌ Comando desconocido: ${command}`);
          console.log('Escribe "help" para ver comandos disponibles');
        }
        break;
    }
    
    rl.prompt();
  });
  
  // Manejar cierre del proceso
  backendProcess.on('close', (code: number | null) => {
    console.log(`\n📋 Backend process ended with code ${code}`);
    rl.close();
  });
  
  // Manejar Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Interrumpiendo monitoreo...');
    backendProcess.kill();
    rl.close();
    process.exit(0);
  });
  
  // Mostrar ayuda inicial
  console.log('\n🔧 COMANDOS DISPONIBLES:');
  console.log('help - Mostrar esta ayuda');
  console.log('exit - Salir');
  console.log('stats - Mostrar estadísticas básicas');
  console.log('');
  rl.prompt();
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main();
}

export { main as logMonitor };
