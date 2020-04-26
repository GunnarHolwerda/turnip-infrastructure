import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const redisCache = new aws.elasticache.Cluster('turnip-redis', {
    engine: 'redis',
    engineVersion: '5.0.5',
    nodeType: 'cache.t2.micro'
})