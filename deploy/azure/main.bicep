// main.bicep — provision ONE Linux VM for the MELEK TESTNET node + Cheetah/Hathor
// test harness + the brain/Memory server (Postgres + pgvector).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ NOTE — NO CRYPTO MINING ON AZURE.                                         │
// │ Azure's Acceptable Use / Online Services Terms prohibit cryptocurrency    │
// │ mining on Azure resources. This VM runs a NON-mining MELEK *testnet*      │
// │ witness node, the off-chain test harness, and the Postgres/pgvector       │
// │ brain. Mining (RandomX / browser-miner / pool) stays OFF Azure — it lives │
// │ on the dedicated mining box (see pool/ + the mining-server brief).        │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Everything sensitive is a PARAMETER with a placeholder default — no real
// names, IPs, SSH keys, or secrets are baked in. The operator supplies real
// values at `az deployment` time (see README.md) or via a .bicepparam file
// that stays in .local/ (gitignored).

// ── parameters ──────────────────────────────────────────────────────────────
@description('Azure region, e.g. eastus, westeurope.')
param location string = resourceGroup().location

@description('Base name for resources (lowercase, no spaces).')
@minLength(3)
@maxLength(20)
param vmName string = 'melek-node'

@description('Admin username for SSH login.')
param adminUsername string = 'melek'

@description('SSH PUBLIC key (ssh-ed25519 ... or ssh-rsa ...). The matching PRIVATE key never leaves the operator. Placeholder — supply the real public key at deploy time.')
@secure()
param sshPublicKey string

@description('VM size. 4 vCPU / 16 GB targets: x86 burstable Standard_B4as_v2, or ARM Standard_D4ps_v5 (cheaper, Ampere). Either satisfies node + Postgres + tests.')
@allowed([
  'Standard_B4as_v2'
  'Standard_D4ps_v5'
  'Standard_D4as_v5'
])
param vmSize string = 'Standard_B4as_v2'

@description('OS disk size in GB (testnet chain + pgvector store).')
@minValue(64)
param osDiskSizeGB int = 128

@description('Your public IP in CIDR form to allow SSH from, e.g. 203.0.113.4/32. Placeholder default opens nothing useful — REPLACE IT. Never commit your real IP to the public repo; pass it at deploy time.')
param sshSourceAddressPrefix string = '0.0.0.0/32'

@description('cloud-init content (base64 is applied by the platform). Pass loadFileAsBase64(\'cloud-init.yaml\') from a wrapper, or inline. Placeholder is an empty cloud-config.')
param cloudInitBase64 string = base64('#cloud-config\n')

@description('Tags applied to every resource.')
param tags object = {
  project: 'MELEK'
  role: 'testnet-node-and-brain'
  mining: 'forbidden-azure-aup'
}

// ── derived names ─────────────────────────────────────────────────────────
var vnetName = '${vmName}-vnet'
var subnetName = '${vmName}-subnet'
var nsgName = '${vmName}-nsg'
var pipName = '${vmName}-pip'
var nicName = '${vmName}-nic'

// ── network security group ────────────────────────────────────────────────
// SSH locked to the operator's address. Testnet P2P (the MELEK Graphene fork's
// default p2p port range) is opened to the internet so the node can peer; the
// RPC + Postgres + brain stay bound to localhost on the VM (cloud-init does NOT
// open them here). Adjust ports to the live testnet config as needed.
resource nsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: nsgName
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-ssh-operator'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: sshSourceAddressPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        name: 'allow-testnet-p2p'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '2001'
        }
      }
    ]
  }
}

// ── virtual network + subnet ──────────────────────────────────────────────
resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.20.0.0/16'] }
    subnets: [
      {
        name: subnetName
        properties: {
          addressPrefix: '10.20.1.0/24'
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

// ── public IP ─────────────────────────────────────────────────────────────
resource pip 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: pipName
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

// ── NIC ───────────────────────────────────────────────────────────────────
resource nic 'Microsoft.Network/networkInterfaces@2023-09-01' = {
  name: nicName
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: { id: '${vnet.id}/subnets/${subnetName}' }
          publicIPAddress: { id: pip.id }
        }
      }
    ]
  }
}

// ── the VM ────────────────────────────────────────────────────────────────
resource vm 'Microsoft.Compute/virtualMachines@2023-09-01' = {
  name: vmName
  location: location
  tags: tags
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      customData: cloudInitBase64
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: osDiskSizeGB
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [{ id: nic.id }]
    }
  }
}

// ── outputs ───────────────────────────────────────────────────────────────
output vmResourceId string = vm.id
output publicIpAddress string = pip.properties.ipAddress
output sshCommand string = 'ssh ${adminUsername}@<public-ip>'
