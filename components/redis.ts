import * as aws from "@pulumi/aws";

export const cacheSecurityGroup = new aws.ec2.SecurityGroup('cache-security-group', {});

const redisCache = new aws.elasticache.Cluster('turnip-redis', {
    engine: 'redis',
    engineVersion: '5.0.5',
    nodeType: 'cache.t2.micro',
    numCacheNodes: 1,
    securityGroupIds: [cacheSecurityGroup.id]
})

export const redisNodes = redisCache.cacheNodes;
export const redisPort = redisCache.port;