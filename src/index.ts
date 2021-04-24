import dotenv from "dotenv"
import express from "express"
const app = express()
import * as fs from "fs"
const {WebClient, LogLevel} = require("@slack/web-api")

dotenv.config()

const PORT = process.env.PORT || 8080

const client = new WebClient(process.env.SLACK_BOT_TOKEN, {
  logLevel: LogLevel.DEBUG,
})

/**
 * これまでに作ってきたペアをすべて取り出して、配列の形にする関数
 *
 * @returns Array<[string, string]>
 */
const getHistoryData = (): Array<[string, string]> => {
  const donePair: Array<[string, string]> = []
  const dirpath = "history" //指定のディレクトリ名
  const flst = fs
    .readdirSync(dirpath, {withFileTypes: true}) //同期でファイル読み込み
    .filter((dirent) => dirent.isFile())
    .map(({name}) => name)

  flst.map((filename) => {
    const jsonObject = JSON.parse(fs.readFileSync(`${dirpath}/${filename}`, "utf-8"))
    jsonObject.data.map((pair: [string, string]) => donePair.push(pair))
  })

  return donePair
}

/**
 * 新しく作った組み合わせが、今回作成しているペアの配列の中に重複していないかをチェックする関数
 *
 * @param newPair 新しく作った組み合わせ
 * @param donePair 今回作成した、ペアの配列
 * @returns Boolean もしひとつ以上入っていたら true | 入っていなければ false を返却
 */
const checkIsDuplicated = (newPair: [string, string], donePair: Array<[string, string]>) => {
  let count = 0
  donePair.map((pair) => {
    const firstMember = newPair[0]
    const secondMember = newPair[1]
    if (pair.includes(firstMember) && pair.includes(secondMember)) {
      count += 1
    }
  })

  return count >= 1
}

/**
 * ペアを作成する関数
 * @param members
 * @returns 出来上がった、ペアの配列
 */
const createPairs = (members: string[]) => {
  // 過去のペアリストを配列で取得
  const historyPair = getHistoryData()
  // これから作るペアの配列の箱
  const pairlist: Array<[string, string]> = []
  // pairlistがペアの配列になっているため、ペアを崩し、memberの名前の配列にする
  const doneUsers: Array<string> = []
  // ランダム数字生成する関数
  const getNumber = () => Math.floor(Math.random() * members.length)

  const numberList = [...Array(members.length).keys()]
  // １から順番に回していく
  numberList.map((currentNumber) => {
    // もし、今の番号が、pairlistの番号に含まれていたら、スキップ（その人はもうペア割り当て済み）
    if (doneUsers.includes(members[currentNumber])) return
    let isLoop = true
    // 人数の数の中からランダムな数字を生成し、添字として使う
    let pairNumber = getNumber()

    while (isLoop) {
      // もしpairに含まれていた場合、もしくは、添字が同じだった場合、再度ランダムな数字（添字）を生成する
      if (doneUsers.includes(members[pairNumber]) || currentNumber === pairNumber) {
        pairNumber = getNumber()
      } else {
        // 含まれていない、一緒でない場合
        const newPair: [string, string] = [members[currentNumber], members[pairNumber]]
        // 過去のpairと照会して、重複チェック
        if (checkIsDuplicated(newPair, historyPair)) {
          // 存在した場合は再度ランダム数字生成（添字）
          pairNumber = getNumber()
        } else {
          isLoop = false
          pairlist.push(newPair)
          doneUsers.push(members[currentNumber], members[pairNumber])
        }
      }
    }
  })
  return pairlist
}

/**
 * 今のmemberの数が偶数か奇数かを判定し、奇数ならば、一人を無作為に抽出して余った人を抜き出して2で割り切れる人数で返却する、偶数ならばそのまま返却する関数
 *
 * @param {プログラム実行時点のslackメンバー全員の名前を格納した配列}
 * @returns {removedUser?: 奇数だった場合に無作為に抽出したメンバー, newMembers: 奇数だった場合はremovedUserを抜き出して偶数にした配列、偶数だった場合はそのままmemberを返却}
 */
const checkIsDivaidable = (members: string[]): {removedUser?: string; newMembers: string[]} => {
  if (members.length % 2 === 0) {
    const newMembers = members
    return {newMembers}
  } else {
    const removedUser = members[Math.floor(Math.random() * members.length)]
    console.log("removedUser", removedUser)
    return {removedUser, newMembers: members.filter((m) => m !== removedUser)}
  }
}

/**
 * 作成したペアの配列をjsonにして保存する関数
 * @param list 今回作成したペアの配列
 * @param removedUser メンバーの数が2で割り切れない数字だった場合の、無作為に抽出したメンバー
 */
const makeJson = (list: Array<[string, string]>, removedUser: string = "") => {
  const d = new Date()
  const formattedDate = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`
  const fileName = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}.json`

  const jsonData = {
    executedDate: formattedDate,
    numberOfPair: list.length,
    removedUser: removedUser,
    data: list.map((p) => p),
  }
  saveJson(jsonData, fileName)
}

const saveJson = (jsonData: any, fileName: string) => {
  const pathname = `history/${fileName}`
  const replacer = ["executedDate", "numberOfPair", "data", "removedUser"] // 改行を見やすくする（本当は配列をもう一つ改行を減らしたい）
  const strJson = JSON.stringify(jsonData, replacer, 2)
  fs.writeFile(pathname, strJson, (err: any) => {
    if (err) throw Error(err)
    if (!err) {
      console.log("Jsonファイル保存完了")
      // console.log(jsonData)
    }
  })
}

/**
 * DMを作成して組み合わせを伝える関数
 *
 * @param userId DMを投げるUserId
 */
const createDM = async (userId1: string, userId2: string) => {
  try {
    const openConversationPayload = {
      users: `${userId1},${userId2}`,
    }
    // DMのグループ作成
    const result1 = await client.conversations.open(openConversationPayload)
    console.log("result of opening conversation", result1.ok)

    const postMessagePayload = {
      channel: result1.channel.id,
      text: `Hi! :wave: <@${userId1}> and <@${userId2}>\nコーヒーチャットの相手が決まったよ！\nコミュニケーションを取って、一週間以内に予定合わせて行ってきてね！ :coffee: :sandwich: :spaghetti: :cake: :rice_ball: :beer:`,
    }
    // 上記で作成したグループのIDに対してメッセージを投げる
    const result2 = await client.chat.postMessage(postMessagePayload)
    console.log("result of postMessage", result2.ok)
  } catch (err) {
    console.log("err", err)
  }
}

app.get("/XFRYEiwOeK3JnywnH3M8x6vh04PxFUpQqkMj1XTtUgynDPrrBe", (_req, _res) => {
  try {
    let members: string[] = []
    const f = async () => {
      const result: any = (await client.users.list()).members
      const idAndNames: {id: string; name: string}[] = []
      result.map((r: any) => {
        const {id, name, is_bot, profile} = r

        if (is_bot === true) return
        if (name === "slackbot") return

        idAndNames.push({
          id: id,
          name: profile.real_name,
        })
        members.push(profile.real_name)
      })

      const {removedUser, newMembers} = checkIsDivaidable(members)

      const resultPairList = createPairs(newMembers)

      const postMessageFunc = resultPairList.map(async (pair) => {
        const firstPerson = pair[0]
        const secondPerson = pair[1]
        const userId1 = idAndNames.find((info) => info.name === firstPerson)?.id as string
        const userId2 = idAndNames.find((info) => info.name === secondPerson)?.id as string

        // 井上晶雄のID
        if (userId1 === "U01SE27EDE2" || userId2 === "U01SE27EDE2") {
          console.log("================================================================")
          console.log("firstPerson", firstPerson, "userId1", userId1)
          console.log("secondPerson", secondPerson, "userId2", userId2)
          await createDM("U01KS3Z0WKV", "U01SE27EDE2")
          // await createDM(userId1, userId2)
        }
      })

      await Promise.all(postMessageFunc)

      if (removedUser) {
        makeJson(resultPairList, removedUser)
      } else {
        makeJson(resultPairList)
      }
    }
    f()
    _res.send({
      status: "OK",
    })
  } catch (error) {
    console.error("error", error)
  }
})

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`)
})
