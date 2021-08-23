"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const awsx = require("@pulumi/awsx");

const config = new pulumi.Config();
const domain = config.require("domain");
const bucketName = config.require("bucketName");

const eastRegion = new aws.Provider("east", {
  profile: aws.config.profile,
  region: "us-east-1",
});
const certificate = new aws.acm.Certificate(
  "domain-cert",
  {
    domainName: domain,
    validationMethod: "DNS",
    subjectAlternativeNames: [`*.${domain}`],
  },
  { provider: eastRegion }
);
const domainValidations = certificate.domainValidationOptions;
const { resourceRecordName, resourceRecordType, resourceRecordValue } =
  domainValidations[0];
const validationRecord = new aws.route53.Record("cert-validation", {
  name: resourceRecordName,
  records: [resourceRecordValue],
  ttl: 60,
  type: resourceRecordType,
  zoneId: config.requireSecret("hostedZoneId"),
});
const validation = new aws.acm.CertificateValidation(
  "cert-validation",
  {
    certificateArn: certificate.arn,
    validationRecordFqdns: [validationRecord.fqdn],
  },
  {
    provider: eastRegion,
  }
);

const wwwDomain = `www.${domain}`;
const bucket = new aws.s3.Bucket("web-bucket", {
  bucket: bucketName,
  website: {
    indexDocument: "index.html",
  },
});
const cdn = new aws.cloudfront.Distribution(
  "web-cdn",
  {
    enabled: true,
    aliases: [domain, wwwDomain],
    origins: [
      {
        originId: bucket.arn,
        domainName: bucket.bucketDomainName,
      },
    ],
    defaultRootObject: "index.html",
    priceClass: "PriceClass_100",
    defaultCacheBehavior: {
      targetOriginId: bucket.arn,
      allowedMethods: ["GET", "HEAD", "OPTIONS"],
      cachedMethods: ["GET", "HEAD", "OPTIONS"],
      viewerProtocolPolicy: "redirect-to-https",
      forwardedValues: {
        cookies: { forward: "none" },
        queryString: false,
      },
    },
    restrictions: {
      geoRestriction: {
        restrictionType: "none",
      },
    },
    viewerCertificate: {
      acmCertificateArn: certificate.arn,
      sslSupportMethod: "sni-only",
    },
    customErrorResponses: [
      {
        errorCode: 403,
        errorCachingMinTtl: 86400,
        responseCode: 200,
        responsePagePath: "/index.html",
      },
      {
        errorCode: 404,
        errorCachingMinTtl: 86400,
        responseCode: 200,
        responsePagePath: "/index.html",
      },
    ],
  },
  { dependsOn: [validation] }
);

// Export the name of the bucket
exports.bucketName = bucket.id;
