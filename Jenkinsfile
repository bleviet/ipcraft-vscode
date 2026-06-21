pipeline {
    agent none
    parameters {
        string(name: 'VIVADO_BIN',
               defaultValue: '/tools/Xilinx/Vivado/2024.2/bin/vivado',
               description: 'Path to Vivado binary on the vendor agent')
        string(name: 'VIVADO_VERSION',
               defaultValue: '2024.2',
               description: 'Vivado version (for reporting)')
        string(name: 'QUARTUS_DOCKER_IMAGE',
               defaultValue: 'cvsoc/quartus:23.1',
               description: 'Docker image for Quartus tests')
        string(name: 'QUARTUS_VERSION',
               defaultValue: '23.1',
               description: 'Quartus version (for reporting)')
        string(name: 'VIVADO_LICENSE_SERVER',
               defaultValue: '',
               description: 'FlexLM license server (e.g., 2100@host)')
    }
    options {
        timeout(time: 2, unit: 'HOURS')
        timestamps()
    }
    stages {
        stage('Quick checks') {
            agent { label 'ipcraft-oss' }
            steps {
                checkout scm
                sh 'npm ci'
                sh 'npm run lint'
                sh 'npm run type-check'
                sh 'npm run test:unit -- --coverage'
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: '**/junit.xml'
                }
            }
        }
        stage('Build') {
            agent { label 'ipcraft-oss' }
            steps {
                sh 'npm run compile'
                sh 'npm run compile-tests'
            }
        }
        stage('HDL integration') {
            agent { label 'ipcraft-oss' }
            steps {
                sh 'npx jest --config config/jest.integration.js --testPathPatterns=snapshots'
                sh 'npx jest --config config/jest.integration.js --testPathPatterns=roundtrip'
                sh 'npx jest --config config/jest.integration.js --testPathPatterns=parser-roundtrip'
                sh 'npm run test:integration:conformance'
                sh 'npm run test:integration:hdl'
                sh 'npm run test:integration:ipxact'
            }
        }
        stage('Testbench execution') {
            agent { label 'ipcraft-oss' }
            steps {
                sh 'npx jest --config config/jest.integration.js --testPathPatterns=testbench'
            }
        }
        stage('Vendor synthesis') {
            agent { label 'ipcraft-vendor' }
            environment {
                VIVADO_BIN             = "${params.VIVADO_BIN}"
                VIVADO_VERSION         = "${params.VIVADO_VERSION}"
                QUARTUS_DOCKER_IMAGE   = "${params.QUARTUS_DOCKER_IMAGE}"
                QUARTUS_VERSION        = "${params.QUARTUS_VERSION}"
                VIVADO_LICENSE_SERVER  = "${params.VIVADO_LICENSE_SERVER}"
                SKIP_TELEMETRY_FILE    = "${WORKSPACE}/skip-telemetry.ndjson"
            }
            steps {
                sh 'REQUIRE_VIVADO=1 npm run test:integration:vivado'
                sh 'REQUIRE_QUARTUS=1 npm run test:integration:quartus'
            }
            post {
                always {
                    archiveArtifacts allowEmptyArchive: true,
                        artifacts: 'skip-telemetry.ndjson',
                        fingerprint: false
                }
            }
        }
        stage('Browser + E2E') {
            agent { label 'ipcraft-oss' }
            steps {
                sh 'npx playwright install --with-deps chromium'
                sh 'xvfb-run -a npm run test:e2e'
                sh 'npm run test:browser'
            }
            post {
                failure {
                    archiveArtifacts allowEmptyArchive: true,
                        artifacts: 'test-results/**,playwright-report/**',
                        fingerprint: false
                }
            }
        }
    }
    post {
        success {
            echo 'All stages passed'
        }
        failure {
            echo 'One or more stages failed'
        }
    }
}
