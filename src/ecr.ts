import * as core from '@actions/core'
import {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  GetLifecyclePolicyCommand,
  GetRepositoryPolicyCommand,
  PutLifecyclePolicyCommand,
  SetRepositoryPolicyCommand,
  Repository,
} from '@aws-sdk/client-ecr'
import assert from 'assert'
import { promises as fs } from 'fs'

type Inputs = {
  repository: string
  lifecyclePolicy?: string
  repositoryPolicy?: string
}

type Outputs = {
  repositoryUri: string
}

export const runForECR = async (inputs: Inputs): Promise<Outputs> => {
  const client = new ECRClient({})

  const repository = await core.group(
    `Create repository ${inputs.repository} if not exist`,
    async () => await createRepositoryIfNotExist(client, inputs.repository),
  )
  assert(repository.repositoryUri !== undefined)

  const lifecyclePolicy = inputs.lifecyclePolicy
  if (lifecyclePolicy !== undefined) {
    await core.group(
      `Put the lifecycle policy to repository ${inputs.repository}`,
      async () => await putLifecyclePolicyIfChanges(client, inputs.repository, lifecyclePolicy),
    )
  }

  const repositoryPolicy = inputs.repositoryPolicy
  if (repositoryPolicy !== undefined) {
    await core.group(
      `Put the repository policy to repository ${inputs.repository}`,
      async () => await setRepositoryPolicyIfChanges(client, inputs.repository, repositoryPolicy),
    )
  }

  return {
    repositoryUri: repository.repositoryUri,
  }
}

const createRepositoryIfNotExist = async (client: ECRClient, name: string): Promise<Repository> => {
  try {
    const describe = await client.send(new DescribeRepositoriesCommand({ repositoryNames: [name] }))
    assert(describe.repositories !== undefined)
    assert.strictEqual(describe.repositories.length, 1)

    const found = describe.repositories[0]
    assert(found.repositoryUri !== undefined)
    core.info(`repository ${found.repositoryUri} found`)
    return found
  } catch (error) {
    if (isRepositoryNotFoundException(error)) {
      const create = await client.send(new CreateRepositoryCommand({ repositoryName: name }))
      assert(create.repository !== undefined)
      assert(create.repository.repositoryUri !== undefined)
      core.info(`repository ${create.repository.repositoryUri} has been created`)
      return create.repository
    }
    throw error
  }
}

const isRepositoryNotFoundException = (e: unknown) => e instanceof Error && e.name === 'RepositoryNotFoundException'
const isLifecyclePolicyNotFoundException = (e: unknown) => e instanceof Error && e.name === 'LifecyclePolicyNotFoundException'
const isRepositoryPolicyNotFoundException = (e: unknown) => e instanceof Error && e.name === 'RepositoryPolicyNotFoundException'

const putLifecyclePolicyIfChanges = async (client: ECRClient, repositoryName: string, path: string): Promise<void> => {
  const lifecyclePolicyText = await fs.readFile(path, { encoding: 'utf-8' })
  core.debug(`Checking if lifecycle policy ${path} has changed for repository ${repositoryName}`)

  try {
    const existingPolicyText = await client.send(new GetLifecyclePolicyCommand({ repositoryName }))
    assert(existingPolicyText.lifecyclePolicyText !== undefined)

    if (JSON.stringify(JSON.parse(lifecyclePolicyText)) !== JSON.stringify(JSON.parse(existingPolicyText.lifecyclePolicyText))) {
      await client.send(new PutLifecyclePolicyCommand({ repositoryName, lifecyclePolicyText }))
      core.info(`Successfully put lifecycle policy ${path} to repository ${repositoryName}`)
    } else {
      core.info(`Lifecycle policy ${path} for repository ${repositoryName} is already up to date`)
    }
  } catch (error) {
    // If the repository has no existing policy, simply put the new policy
    if (isRepositoryNotFoundException(error) || isLifecyclePolicyNotFoundException(error)) {
      await client.send(new PutLifecyclePolicyCommand({ repositoryName, lifecyclePolicyText }))
      core.info(`Successfully put lifecycle policy ${path} to repository ${repositoryName}`)
    } else {
      throw error
    }
  }
}

const setRepositoryPolicyIfChanges = async (client: ECRClient, repositoryName: string, path: string): Promise<void> => {
  const policyText = await fs.readFile(path, { encoding: 'utf-8' })
  core.debug(`Checking if repository policy ${path} has changed for repository ${repositoryName}`)

  try {
    const existingPolicyText = await client.send(new GetRepositoryPolicyCommand({ repositoryName }))
    assert(existingPolicyText.policyText !== undefined)

    if (JSON.stringify(JSON.parse(policyText)) !== JSON.stringify(JSON.parse(existingPolicyText.policyText))) {
      await client.send(new SetRepositoryPolicyCommand({ repositoryName, policyText }))
      core.info(`Successfully set repository policy ${path} to repository ${repositoryName}`)
    } else {
      core.info(`Repository policy ${path} for repository ${repositoryName} is already up to date`)
    }
  } catch (error) {
    // If the repository has no existing policy, simply set the new policy
    if (isRepositoryNotFoundException(error) || isRepositoryPolicyNotFoundException(error)) {
      await client.send(new SetRepositoryPolicyCommand({ repositoryName, policyText }))
      core.info(`Successfully set repository policy ${path} to repository ${repositoryName}`)
    } else {
      throw error
    }
  }
}
