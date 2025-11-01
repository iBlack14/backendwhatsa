const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function checkNetwork() {
  try {
    console.log('🔍 Verificando redes de Docker...\n');
    
    // Listar todas las redes
    const networks = await docker.listNetworks();
    console.log('📋 Redes disponibles:');
    networks.forEach(net => {
      console.log(`  - ${net.Name} (${net.Driver})`);
    });
    
    // Verificar si existe la red 'easypanel'
    const easypanelNet = networks.find(n => n.Name === 'easypanel');
    if (easypanelNet) {
      console.log('\n✅ Red "easypanel" encontrada');
      
      // Inspeccionar la red
      const network = docker.getNetwork('easypanel');
      const info = await network.inspect();
      
      console.log('\n📊 Contenedores en la red easypanel:');
      Object.keys(info.Containers || {}).forEach(containerId => {
        const container = info.Containers[containerId];
        console.log(`  - ${container.Name} (${container.IPv4Address})`);
      });
    } else {
      console.log('\n❌ Red "easypanel" NO encontrada');
      console.log('💡 Posibles soluciones:');
      console.log('   1. La red puede tener otro nombre');
      console.log('   2. Necesitas crear la red manualmente');
    }
    
    // Listar contenedores de N8N
    console.log('\n🔍 Buscando contenedores de N8N...');
    const containers = await docker.listContainers({ all: true });
    const n8nContainers = containers.filter(c => 
      c.Names.some(name => name.includes('n8n') || name.includes('adasasd') || name.includes('hola'))
    );
    
    if (n8nContainers.length > 0) {
      console.log(`\n✅ Encontrados ${n8nContainers.length} contenedor(es) de N8N:`);
      for (const c of n8nContainers) {
        console.log(`\n  📦 ${c.Names[0]}`);
        console.log(`     Estado: ${c.State}`);
        console.log(`     Puertos: ${JSON.stringify(c.Ports)}`);
        
        // Inspeccionar contenedor
        const container = docker.getContainer(c.Id);
        const info = await container.inspect();
        
        console.log(`     Redes:`);
        Object.keys(info.NetworkSettings.Networks || {}).forEach(netName => {
          console.log(`       - ${netName}`);
        });
        
        console.log(`     Labels de Traefik:`);
        Object.keys(info.Config.Labels || {}).forEach(label => {
          if (label.includes('traefik')) {
            console.log(`       - ${label}: ${info.Config.Labels[label]}`);
          }
        });
      }
    } else {
      console.log('\n❌ No se encontraron contenedores de N8N');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkNetwork();
