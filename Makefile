.PHONY: build lint test smoke image agent-image integration play clean

build:
	bunx tsc
	cd container/agent-runner && npm install --silent && bunx tsc

lint:
	bunx tsc --noEmit
	cd container/agent-runner && npm install --silent && bunx tsc --noEmit

test:
	bunx vitest run src tests/e2e

smoke:
	bunx vitest run

image:
	sudo docker build -t kanipi .

agent-image:
	cd container && sudo docker build -t kanipi-agent .

integration: agent-image
	bunx vitest run tests/integration --testTimeout=120000

play:
	npx playwright test

clean:
	rm -rf tmp/ dist/ container/agent-runner/dist/
