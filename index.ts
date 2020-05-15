import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { dbEndpoint, dbName, dbUser, dbPassword, dbSecurityGroup, dbPort } from './components/db';
import { redisNodes, redisPort, cacheSecurityGroup } from './components/redis';

const config = new pulumi.Config();

const environment = pulumi.all([redisNodes, redisPort, dbEndpoint, dbUser, dbName])
    .apply(([redisNodes, rPort, typeOrmEndpoint, typeOrmUser, typeOrmDb]) => [
        { name: 'REDIS_HOST', value: redisNodes.find(n => n.address)?.address || '' },
        { name: 'REDIS_PORT', value: rPort.toString() },
        { name: 'TYPEORM_HOST', value: typeOrmEndpoint },
        { name: 'TYPEORM_CONNECTION', value: 'postgres' },
        { name: 'TYPEORM_USERNAME', value: typeOrmUser },
        { name: 'TYPEORM_DATABASE', value: typeOrmDb },
        { name: 'TYPEORM_PORT', value: '5432' },
        { name: 'TYPEORM_SYNCHRONIZE', value: config.get('dbSynchronize') || 'false' },
        { name: 'TYPEORM_LOGGING', value: config.get('dbLogging') || 'false' },
        { name: 'TYPEORM_ENTITIES', value: config.require('entitiesPath') },
        { name: 'TYPEORM_MIGRATIONS', value: config.require('migrationsPath') },
        { name: 'TYPEORM_SUBSCRIBERS', value: config.require('subscribersPath') },
    ]);

const discordToken = config.requireSecret('discordToken');

const turnipBotTaskExecutionRole = new aws.iam.Role('turnip-bot-task-execution', {
    assumeRolePolicy: {
        Version: "2012-10-17",
        Statement: [
            {
                "Sid": "",
                "Effect": "Allow",
                "Principal": { "Service": "ecs-tasks.amazonaws.com" },
                "Action": "sts:AssumeRole"
            }
        ]
    }
})

const taskRolePolicy = new aws.iam.RolePolicy('turnip-bo-task-execution-policy', {
    role: turnipBotTaskExecutionRole,
    policy: {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "ecr:GetAuthorizationToken",
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchGetImage",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                    "ssm:GetParameters",
                    "secretsmanager:GetSecretValue",
                    "kms:Decrypt"
                ],
                "Resource": "*"
            }
        ]
    }
});

const createSecretWithValue = (name: string, secretString: pulumi.Input<string>): aws.secretsmanager.Secret => {
    const secret = new aws.secretsmanager.Secret(`turnip-bot-${name}`);
    new aws.secretsmanager.SecretVersion(name, { secretId: secret.id, secretString });
    return secret;
}

const createSecureParameter = (name: string, value: pulumi.Input<string>): aws.ssm.Parameter => {
    return new aws.ssm.Parameter(`${name}-param`, { type: 'SecureString', value });
}

const registrySecret = config.requireSecret('dockerRegistryToken').apply(token => JSON.stringify({
    username: 'GunnarHolwerda',
    password: token
}));
const turnipRegistrySecret = createSecretWithValue('registry-token', registrySecret);
const discordParameter = createSecureParameter('discord-token', discordToken);
const dbPassParameter = createSecureParameter('db-pass', dbPassword);

// Create an AWS resource (S3 Bucket)
const botService = new awsx.ecs.FargateService('turnip-bot', {
    desiredCount: 1,
    taskDefinitionArgs: {
        executionRole: turnipBotTaskExecutionRole,
        containers: {
            turnipBot: {
                repositoryCredentials: turnipRegistrySecret.arn.apply(s => ({ credentialsParameter: s })),
                image: config.require('bot-container'),
                memory: 128,
                environment: environment,
                secrets: pulumi.all([discordParameter.arn, dbPassParameter.arn]).apply(([token, pass]) => ([
                    { name: 'DISCORD_TOKEN', valueFrom: token },
                    { name: 'TYPEORM_PASSWORD', valueFrom: pass }
                ]))
            }
        }
    }
});

botService.cluster.securityGroups.forEach(sg => {
    // Create rules for accessing to allow traffic from our service to and from Redis
    new aws.ec2.SecurityGroupRule('service-cache-ingress', {
        securityGroupId: cacheSecurityGroup.id,
        fromPort: redisPort,
        toPort: redisPort,
        protocol: 'tcp',
        type: 'ingress',
        sourceSecurityGroupId: sg.id
    });
    new aws.ec2.SecurityGroupRule('service-cache-egress', {
        securityGroupId: cacheSecurityGroup.id,
        fromPort: redisPort,
        toPort: redisPort,
        protocol: 'tcp',
        type: 'egress',
        sourceSecurityGroupId: sg.id
    });

    // Create rules for accessing to allow traffic from our service to and from RDS
    new aws.ec2.SecurityGroupRule('service-db-ingress', {
        securityGroupId: dbSecurityGroup.id,
        fromPort: dbPort,
        toPort: dbPort,
        protocol: 'tcp',
        type: 'ingress',
        sourceSecurityGroupId: sg.id
    })
    new aws.ec2.SecurityGroupRule('service-db-egress', {
        securityGroupId: dbSecurityGroup.id,
        fromPort: dbPort,
        toPort: dbPort,
        protocol: 'tcp',
        type: 'egress',
        sourceSecurityGroupId: sg.id
    })

    // Create rules for RDS instance to allow traffic from and to service
    new aws.ec2.SecurityGroupRule('db-ingress', {
        securityGroupId: sg.id,
        fromPort: dbPort,
        toPort: dbPort,
        protocol: 'tcp',
        type: 'egress',
        sourceSecurityGroupId: dbSecurityGroup.id
    })
    new aws.ec2.SecurityGroupRule('db-egress', {
        securityGroupId: sg.id,
        fromPort: dbPort,
        toPort: dbPort,
        protocol: 'tcp',
        type: 'egress',
        sourceSecurityGroupId: dbSecurityGroup.id
    })
})

export { dbEndpoint }