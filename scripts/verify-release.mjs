import { readFileSync, statSync } from 'node:fs';
import { unzipSync } from 'fflate';

const file = 'release/cf-vps-monitor-v1.0.0.zip';
const contents = unzipSync(readFileSync(file));
const paths = Object.keys(contents);
const privateFiles = paths.filter(path => /\/(\.dev\.vars|\.local-admin|\.production-secrets\.json|\.wrangler|node_modules|upstream|review)(\/|$)/.test(path));
if (privateFiles.length) throw new Error(`Private files in release: ${privateFiles.join(', ')}`);
if (!paths.some(path => path.endsWith('部署与使用手册.md'))) throw new Error('Manual missing');
const binaries = paths.filter(path => /release\/agent\/cf-monitor-agent-/.test(path));
if (binaries.length !== 8) throw new Error('Missing platform binaries');
console.log(JSON.stringify({ files: paths.length, binaries: binaries.length, sizeMiB: (statSync(file).size / 1024 / 1024).toFixed(1), privateFiles: privateFiles.length }));
