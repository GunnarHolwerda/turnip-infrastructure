import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as postgresql from '@pulumi/postgresql';
import { TcpPorts } from '@pulumi/awsx/ec2';

const config = new pulumi.Config();
const rootUser = config.require('rdsRootUser');
const rootPassword = config.requireSecret('rdsRootPassword');
const dbPort = 5432;
const devIpCidrBlock = config.getSecret('devIp') ? config.getSecret('devIp')?.apply(ip => `${ip}/32`) : undefined;

const dbSecurityGroup = new aws.ec2.SecurityGroup('db-security-group', { ingress: [], egress: [] });
pulumi.all([devIpCidrBlock, dbSecurityGroup.id]).apply(([devIp, sgId]) => {
    if (!devIp) {
        return;
    }
    new aws.ec2.SecurityGroupRule('devip-ingress', {
        securityGroupId: sgId,
        protocol: 'tcp',
        fromPort: dbPort,
        toPort: dbPort,
        cidrBlocks: [devIp],
        type: 'ingress'
    });
    new aws.ec2.SecurityGroupRule('devip-egress', {
        securityGroupId: sgId,
        protocol: 'tcp',
        fromPort: dbPort,
        toPort: dbPort,
        cidrBlocks: [devIp],
        type: 'egress'
    });
})

const rds = new aws.rds.Instance('turnip-db', {
    engine: 'postgres',
    username: rootUser,
    password: rootPassword,
    availabilityZone: 'us-west-2a',
    instanceClass: 'db.t3.micro',
    allocatedStorage: 20,
    publiclyAccessible: true,
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [dbSecurityGroup.id]
});

const dbEndpoint = rds.endpoint.apply(e => e.substring(0, e.indexOf(':')));

const postgresProvider = new postgresql.Provider('postgres', {
    username: rds.username,
    host: dbEndpoint,
    expectedVersion: rds.engineVersion,
    superuser: false,
    password: rds.password as pulumi.Input<string>
});

const appDatabaseName = config.require('postgresDb');
const appDatabaseUser = config.require('postgresUser');
const appDbPassword = config.requireSecret('postgresPassword');

const user = new postgresql.Role('app-db-user', {
    login: true,
    password: appDbPassword,
    createDatabase: true,
    createRole: true,
    skipReassignOwned: true,
    name: appDatabaseUser
}, {
    provider: postgresProvider,
    additionalSecretOutputs: ['password']
});

const db = new postgresql.Database('app-db', {
    name: appDatabaseName,
    owner: user.name
}, {
    provider: postgresProvider
})

const dbUser = user.name;
const dbPassword = user.password as pulumi.Output<string>;
const dbName = db.name;

export { dbEndpoint, dbUser, dbPassword, dbName, dbSecurityGroup, dbPort };