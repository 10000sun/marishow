// 채널별 슬래시 명령어 정의. 실제 마리봇의 명령어 체계(mari/인수인계서_일반유저_명령어.md 기준)를
// 반영하되, 백엔드 DB 없이 브라우저 세션 안에서만 도는 목(mock) 경제로 동작한다.
const MariCommands = (function () {
  const S = MariState;

  function embed(tone, title, lines, fields, footer) {
    return { tone, title, lines: lines || [], fields: fields || [], footer };
  }

  function errorEmbed(text) {
    return embed("error", "실행할 수 없어요", [text]);
  }

  function needFeature(name) {
    const s = S.get();
    if (!s.featureFlags[name]) {
      return errorEmbed(`"${name}" 기능은 관리자가 지금 정지해뒀어. 관리자 모드를 켜고 #관리자-전용에서 다시 켤 수 있어.`);
    }
    return null;
  }

  function needAdmin(isAdminContext) {
    if (!isAdminContext) {
      return errorEmbed("이 명령어는 관리자 전용이야. 우측 상단 토글을 켜고 다시 시도해줘.");
    }
    return null;
  }

  // ---------- 지갑 · 경제 ----------
  const walletCommands = [
    {
      name: "/지갑",
      description: "내 에바 잔고와 인벤토리 보기",
      run() {
        const s = S.get();
        const items = Object.entries(s.inventory)
          .filter(([, qty]) => qty > 0)
          .map(([id, qty]) => {
            const item = s.shop.find((i) => i.id === id);
            return `${item ? item.name : id} x${qty}`;
          });
        return embed(
          "default",
          "💳 지갑",
          [`잔고: ${S.formatEva(s.wallet.balance)}`],
          [{ label: "인벤토리", value: items.length ? items.join(", ") : "없음" }],
          "채널에 공개되는 정보입니다"
        );
      },
    },
    {
      name: "/지갑내역 조회",
      description: "최근 입출금 내역 보기",
      run() {
        const s = S.get();
        if (!s.history.length) {
          return embed("default", "📜 지갑내역", ["아직 거래 내역이 없어."]);
        }
        const lines = s.history.slice(0, 10).map((h) => {
          const sign = h.amount >= 0 ? "+" : "";
          return `${sign}${h.amount.toLocaleString("ko-KR")} 에바 · ${h.memo}`;
        });
        return embed("default", "📜 지갑내역 (최근 10건, 나만 보임)", lines);
      },
    },
    {
      name: "/송금",
      args: "대상 금액",
      description: "다른 멤버에게 에바 보내기",
      run(args) {
        const blocked = needFeature("송금");
        if (blocked) return blocked;

        const [target, amountStr] = args;
        const amount = Number(amountStr);
        if (!target || !Number.isFinite(amount) || amount <= 0) {
          return errorEmbed("사용법: /송금 대상 금액  (예: /송금 타운가이드 500)");
        }
        const s = S.get();
        if (s.wallet.balance < 0) {
          return errorEmbed("잔고가 마이너스라 송금이 막혀 있어. 먼저 잔고를 채워줘.");
        }
        if (amount > s.wallet.balance) {
          return errorEmbed(`잔고가 부족해. 지금 잔고는 ${S.formatEva(s.wallet.balance)}야.`);
        }
        s.wallet.balance -= amount;
        S.addHistory("송금", -amount, `${target}에게 송금`);
        S.notify();
        return embed("default", "💸 송금 완료", [`${target}님에게 ${S.formatEva(amount)}를 보냈어요.`]);
      },
    },
    {
      name: "/출석",
      description: "하루 한 번 출석 체크",
      run() {
        const blocked = needFeature("출석");
        if (blocked) return blocked;

        const s = S.get();
        if (s.attendance.done) {
          return errorEmbed("오늘은 이미 출석했어! (데모에서는 세션당 1회)");
        }
        s.attendance.done = true;
        s.attendance.streak += 1;
        s.wallet.balance += s.attendance.reward;
        S.addHistory("출석", s.attendance.reward, "출석 보상");
        S.notify();
        return embed(
          "default",
          "🌞 출석 완료",
          [`오늘 출석 ${s.attendance.streak}일째! ${S.formatEva(s.attendance.reward)}를 받았어요.`]
        );
      },
    },
    {
      name: "/캠프 세금조회",
      description: "이번 회차 세금 조회 (조회만, 나만 보임)",
      run() {
        const s = S.get();
        const tax = Math.max(0, Math.round(s.wallet.balance * 0.1));
        return embed(
          "default",
          "🏦 캠프 세금 조회",
          [`과세표준 기준 예상 세액: ${S.formatEva(tax)}`],
          [],
          "실제 납부 버튼은 이 데모에서는 시연하지 않습니다"
        );
      },
    },
    {
      name: "/지급",
      args: "대상 금액",
      description: "[관리자] 멤버에게 에바 지급",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        const [target, amountStr] = args;
        const amount = Number(amountStr);
        if (!target || !Number.isFinite(amount)) {
          return errorEmbed("사용법: /지급 대상 금액");
        }
        const s = S.get();
        s.wallet.balance += amount;
        S.addHistory("관리자 지급", amount, `관리자가 ${target}에게 지급`);
        S.notify();
        return embed("admin", "🛠 지급 완료", [`${target}에게 ${S.formatEva(amount)}를 지급했어요.`]);
      },
    },
  ];

  // ---------- 주식 ----------
  const stockCommands = [
    {
      name: "/주식 목록",
      description: "상장 종목 시세 보기",
      run() {
        const s = S.get();
        const lines = s.stocks.map((st) => {
          const diff = st.price - st.prevClose;
          const pct = ((diff / st.prevClose) * 100).toFixed(2);
          const arrow = diff > 0 ? "🔺" : diff < 0 ? "🔻" : "▪";
          return `${arrow} ${st.name}: ${st.price.toLocaleString("ko-KR")} (${diff >= 0 ? "+" : ""}${pct}%)`;
        });
        return embed("default", "📈 주식 목록 (4초마다 시세 변동)", lines);
      },
    },
    {
      name: "/주식 매수",
      args: "종목 수량",
      description: "주식 사기",
      run(args) {
        const blocked = needFeature("주식");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr);
        const s = S.get();
        const stock = s.stocks.find((st) => st.name === name);
        if (!stock || !Number.isFinite(qty) || qty <= 0) {
          return errorEmbed("사용법: /주식 매수 종목 수량  (예: /주식 매수 은하전자 5)");
        }
        const cost = stock.price * qty;
        if (cost > s.wallet.balance) {
          return errorEmbed(`잔고가 부족해. 필요 금액 ${S.formatEva(cost)}, 보유 ${S.formatEva(s.wallet.balance)}`);
        }
        s.wallet.balance -= cost;
        s.portfolio[name] = (s.portfolio[name] || 0) + qty;
        S.addHistory("주식 매수", -cost, `${name} ${qty}주 매수`);
        S.notify();
        return embed("default", "📥 매수 완료", [`${name} ${qty}주를 ${S.formatEva(cost)}에 샀어요.`]);
      },
    },
    {
      name: "/주식 매도",
      args: "종목 수량",
      description: "주식 팔기",
      run(args) {
        const blocked = needFeature("주식");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr);
        const s = S.get();
        const stock = s.stocks.find((st) => st.name === name);
        const holding = s.portfolio[name] || 0;
        if (!stock || !Number.isFinite(qty) || qty <= 0) {
          return errorEmbed("사용법: /주식 매도 종목 수량");
        }
        if (qty > holding) {
          return errorEmbed(`보유 수량이 부족해. 지금 ${name} ${holding}주 보유 중.`);
        }
        const proceeds = stock.price * qty;
        s.wallet.balance += proceeds;
        s.portfolio[name] = holding - qty;
        S.addHistory("주식 매도", proceeds, `${name} ${qty}주 매도`);
        S.notify();
        return embed("default", "📤 매도 완료", [`${name} ${qty}주를 ${S.formatEva(proceeds)}에 팔았어요.`]);
      },
    },
    {
      name: "/주식 포폴",
      description: "내 포트폴리오 보기",
      run() {
        const s = S.get();
        const rows = Object.entries(s.portfolio).filter(([, qty]) => qty > 0);
        if (!rows.length) {
          return embed("default", "📊 포트폴리오", ["보유 중인 종목이 없어요."]);
        }
        let total = 0;
        const lines = rows.map(([name, qty]) => {
          const stock = s.stocks.find((st) => st.name === name);
          const value = stock ? stock.price * qty : 0;
          total += value;
          return `${name} ${qty}주 · 평가액 ${value.toLocaleString("ko-KR")} 에바`;
        });
        lines.push(`총 평가액: ${S.formatEva(total)}`);
        return embed("default", "📊 포트폴리오 (나만 보임)", lines);
      },
    },
    {
      name: "/주식 변동",
      args: "종목 등락률(%)",
      description: "[관리자] 특정 종목 시세 강제 변동",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        const [name, pctStr] = args;
        const pct = Number(pctStr);
        const s = S.get();
        const stock = s.stocks.find((st) => st.name === name);
        if (!stock || !Number.isFinite(pct)) {
          return errorEmbed("사용법: /주식 변동 종목 등락률  (예: /주식 변동 은하전자 -10)");
        }
        stock.prevClose = stock.price;
        stock.price = Math.max(100, Math.round(stock.price * (1 + pct / 100)));
        S.notify();
        return embed("admin", "🛠 시세 변동 적용", [`${name} 가격을 ${pct > 0 ? "+" : ""}${pct}% 조정했어요.`]);
      },
    },
  ];

  // ---------- 상점 ----------
  const shopCommands = [
    {
      name: "/상점 목록",
      description: "매대 상품 보기",
      run() {
        const s = S.get();
        const lines = s.shop.map(
          (item) =>
            `${item.name} · ${item.price.toLocaleString("ko-KR")} 에바 · 재고 ${item.stock} · 되팔기 ${item.resalePercent}%${
              item.roleItem ? " · 역할 아이템" : ""
            }`
        );
        return embed("default", "🛒 매대 목록", lines);
      },
    },
    {
      name: "/상점 구매",
      args: "아이템 수량",
      description: "매대에서 아이템 구매",
      run(args) {
        const blocked = needFeature("상점");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr) || 1;
        const s = S.get();
        const item = s.shop.find((i) => i.name === name);
        if (!item) return errorEmbed("사용법: /상점 구매 아이템 수량  (예: /상점 구매 확성기 1)");
        if (item.stock < qty) return errorEmbed(`재고가 부족해요. 남은 재고 ${item.stock}개.`);
        const cost = item.price * qty;
        if (cost > s.wallet.balance) {
          return errorEmbed(`잔고가 부족해. 필요 금액 ${S.formatEva(cost)}`);
        }
        s.wallet.balance -= cost;
        item.stock -= qty;
        s.inventory[item.id] = (s.inventory[item.id] || 0) + qty;
        S.addHistory("상점 구매", -cost, `${item.name} x${qty} 구매`);
        S.notify();
        return embed("default", "🛍 구매 완료", [`${item.name} ${qty}개를 ${S.formatEva(cost)}에 샀어요.`]);
      },
    },
    {
      name: "/상점 되팔기",
      args: "아이템 수량",
      description: "산 아이템 되팔기",
      run(args) {
        const blocked = needFeature("상점");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr) || 1;
        const s = S.get();
        const item = s.shop.find((i) => i.name === name);
        if (!item) return errorEmbed("사용법: /상점 되팔기 아이템 수량");
        const owned = s.inventory[item.id] || 0;
        if (owned < qty) return errorEmbed(`보유 수량이 부족해요. 지금 ${owned}개 보유 중.`);
        const refund = Math.round(item.price * qty * (item.resalePercent / 100));
        s.wallet.balance += refund;
        item.stock += qty;
        s.inventory[item.id] = owned - qty;
        S.addHistory("상점 되팔기", refund, `${item.name} x${qty} 되팔기`);
        S.notify();
        return embed("default", "♻️ 되팔기 완료", [`${item.name} ${qty}개를 되팔아 ${S.formatEva(refund)}를 받았어요.`]);
      },
    },
    {
      name: "/상점 생성",
      args: "아이템 가격",
      description: "[관리자] 매대에 새 상품 추가",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        const [name, priceStr] = args;
        const price = Number(priceStr);
        if (!name || !Number.isFinite(price)) {
          return errorEmbed("사용법: /상점 생성 아이템 가격");
        }
        const s = S.get();
        s.shop.push({ id: name, name, price, resalePercent: 50, stock: 10, roleItem: false });
        S.notify();
        return embed("admin", "🛠 상품 등록", [`"${name}"을(를) ${S.formatEva(price)}에 매대에 등록했어요.`]);
      },
    },
  ];

  // ---------- 복권 ----------
  const lotteryCommands = [
    {
      name: "/복권 구매",
      args: "번호1 번호2 번호3 번호4",
      description: "복권 한 장 구매",
      run(args) {
        const s = S.get();
        if (args.length < 4) return errorEmbed("사용법: /복권 구매 3 14 22 41 (숫자 4개)");
        if (s.lottery.ticketPrice > s.wallet.balance) {
          return errorEmbed(`잔고가 부족해요. 티켓 가격 ${S.formatEva(s.lottery.ticketPrice)}`);
        }
        s.wallet.balance -= s.lottery.ticketPrice;
        s.lottery.pool += s.lottery.ticketPrice;
        s.lottery.myTickets.push(args.slice(0, 4));
        S.addHistory("복권 구매", -s.lottery.ticketPrice, "복권 1장 구매");
        S.notify();
        return embed("default", "🎟 복권 구매 완료", [`번호 [${args.slice(0, 4).join(", ")}]로 한 장 샀어요.`]);
      },
    },
    {
      name: "/복권 목록",
      description: "내가 산 번호 보기",
      run() {
        const s = S.get();
        if (!s.lottery.myTickets.length) return embed("default", "🎟 내 복권", ["이번 회차에 산 복권이 없어요."]);
        const lines = s.lottery.myTickets.map((t, i) => `#${i + 1}: ${t.join(", ")}`);
        return embed("default", `🎟 내 복권 (${s.lottery.round}회차)`, lines);
      },
    },
    {
      name: "/복권 회차",
      description: "이번 회차 현황 보기",
      run() {
        const s = S.get();
        return embed("default", `🎰 ${s.lottery.round}회차 현황`, [
          `누적 판매액: ${S.formatEva(s.lottery.pool)}`,
          `티켓 가격: ${S.formatEva(s.lottery.ticketPrice)}`,
          `내 보유 티켓: ${s.lottery.myTickets.length}장`,
        ]);
      },
    },
    {
      name: "/복권 당첨확인",
      description: "지금 바로 추첨 결과 확인 (데모 전용 즉시 추첨)",
      run() {
        const s = S.get();
        if (!s.lottery.myTickets.length) return errorEmbed("보유한 복권이 없어요. 먼저 구매해봐!");
        const matches = s.lottery.myTickets.map((t) => t.filter((n) => Math.random() < 0.25).length);
        const best = Math.max(...matches);
        let prize = 0;
        let rank = "낙첨";
        if (best >= 4) {
          prize = Math.round(s.lottery.pool * 0.5);
          rank = "1등";
        } else if (best === 3) {
          prize = Math.round(s.lottery.pool * 0.3);
          rank = "2등";
        } else if (best === 2) {
          prize = Math.round(s.lottery.pool * 0.15);
          rank = "3등";
        }
        if (prize > 0) {
          s.wallet.balance += prize;
          S.addHistory("복권 당첨", prize, `${s.lottery.round}회차 ${rank}`);
        }
        s.lottery.round += 1;
        s.lottery.pool = Math.round(s.lottery.pool * 0.1);
        s.lottery.myTickets = [];
        S.notify();
        return embed(
          prize > 0 ? "default" : "error",
          prize > 0 ? `🎉 ${rank} 당첨!` : "😢 낙첨",
          [prize > 0 ? `${S.formatEva(prize)}를 받았어요! 다음 회차가 시작됐어요.` : "다음 회차에 다시 도전해봐요."]
        );
      },
    },
  ];

  // ---------- 미니게임 ----------
  const hiLow = { open: false, current: null };
  const leaderboard = [
    { name: "타운가이드", wins: 12 },
    { name: "여백이", wins: 9 },
    { name: "악동왕", wins: 7 },
  ];

  const minigameCommands = [
    {
      name: "/하이로우",
      description: "하이로우 판 열기",
      run() {
        hiLow.open = true;
        hiLow.current = 1 + Math.floor(Math.random() * 100);
        return embed("default", "🎲 하이로우 시작", [
          `현재 숫자: ${hiLow.current}`,
          "다음 숫자가 더 높을지 낮을지 /하이 또는 /로우로 맞혀봐!",
        ]);
      },
    },
    {
      name: "/하이",
      description: "다음 숫자가 더 높다에 베팅",
      run() {
        return resolveHiLow("high");
      },
    },
    {
      name: "/로우",
      description: "다음 숫자가 더 낮다에 베팅",
      run() {
        return resolveHiLow("low");
      },
    },
    {
      name: "/미니게임 랭킹",
      description: "미니게임 랭킹 보기",
      run() {
        const lines = leaderboard
          .slice()
          .sort((a, b) => b.wins - a.wins)
          .map((row, i) => `${i + 1}위 ${row.name} — ${row.wins}승`);
        return embed("default", "🏆 미니게임 랭킹", lines);
      },
    },
  ];

  function resolveHiLow(pick) {
    if (!hiLow.open) return errorEmbed("먼저 /하이로우로 판을 열어야 해!");
    const next = 1 + Math.floor(Math.random() * 100);
    const won = pick === "high" ? next > hiLow.current : next < hiLow.current;
    const prev = hiLow.current;
    hiLow.open = false;
    if (won) {
      let me = leaderboard.find((r) => r.name === "나");
      if (!me) {
        me = { name: "나", wins: 0 };
        leaderboard.push(me);
      }
      me.wins += 1;
    }
    return embed(
      won ? "default" : "error",
      won ? "🎉 성공!" : "😢 실패",
      [`이전 숫자 ${prev} → 다음 숫자 ${next}. ${won ? "맞혔어요!" : "다음 기회에!"}`]
    );
  }

  // ---------- 프로필 · 위키 ----------
  const wiki = {
    나: { 좌우명: "오늘도 무사히", 서식지: "지갑 채널", mbti: "ENFP", tmi: "복권을 은근히 자주 삽니다" },
  };

  const profileCommands = [
    {
      name: "/프로필",
      description: "내 프로필 카드 보기",
      run() {
        return embed(
          "default",
          "🪪 프로필",
          [],
          [
            { label: "닉네임", value: "체험유저" },
            { label: "레벨", value: "Lv.7" },
            { label: "소속 캠프", value: "여백" },
            { label: "업적", value: "출석왕, 초보 투자자" },
          ],
          "채널에 공개되는 카드입니다"
        );
      },
    },
    {
      name: "/위키 조회",
      description: "멤버 TMI 카드 보기",
      run() {
        const w = wiki["나"];
        return embed("default", "📖 위키 · 나", [
          `좌우명: ${w.좌우명}`,
          `서식지: ${w.서식지}`,
          `MBTI: ${w.mbti}`,
          `TMI: ${w.tmi}`,
        ]);
      },
    },
    {
      name: "/위키 목록",
      description: "서버 멤버 위키 목록",
      run() {
        return embed("default", "📖 위키 목록", ["나 · 타운가이드 · 여백이 · 악동왕", "각 이름으로 /위키 조회를 써보세요 (데모는 '나'만 실데이터)"]);
      },
    },
    {
      name: "/생일 확인",
      description: "멤버 생일 확인",
      run() {
        return embed("default", "🎂 생일 확인", ["체험유저님의 생일: 7월 24일"]);
      },
    },
    {
      name: "/아이디 조회",
      description: "등록된 게임 아이디 확인",
      run() {
        return embed("default", "🎮 아이디 조회", ["라이엇: 체험#kr1", "스팀: 76561198000000000"]);
      },
    },
    {
      name: "/위키 등록",
      args: "내용",
      description: "[관리자] 위키 내용 등록/수정",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        if (!args.length) return errorEmbed("사용법: /위키 등록 내용");
        wiki["나"].tmi = args.join(" ");
        return embed("admin", "🛠 위키 수정", ["TMI 항목을 갱신했어요."]);
      },
    },
  ];

  // ---------- 관리자 전용 ----------
  const adminCommands = [
    {
      name: "/기능제어 상태",
      description: "기능 정지 상태 확인 (권한 불필요)",
      run() {
        const s = S.get();
        const lines = Object.entries(s.featureFlags).map(([k, v]) => `${v ? "🟢" : "🔴"} ${k}`);
        return embed("default", "⚙️ 기능제어 상태", lines);
      },
    },
    {
      name: "/기능제어 정지",
      args: "기능명",
      description: "[관리자] 기능 정지",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        const s = S.get();
        const key = args[0];
        if (!(key in s.featureFlags)) return errorEmbed("존재하는 기능명이 아니에요. /기능제어 상태로 목록을 확인해줘.");
        s.featureFlags[key] = false;
        S.notify();
        return embed("admin", "🛠 기능 정지", [`"${key}" 기능을 정지했어요. 다른 채널에서 바로 막히는지 확인해보세요.`]);
      },
    },
    {
      name: "/기능제어 재개",
      args: "기능명",
      description: "[관리자] 기능 재개",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        const s = S.get();
        const key = args[0];
        if (!(key in s.featureFlags)) return errorEmbed("존재하는 기능명이 아니에요. /기능제어 상태로 목록을 확인해줘.");
        s.featureFlags[key] = true;
        S.notify();
        return embed("admin", "🛠 기능 재개", [`"${key}" 기능을 다시 켰어요.`]);
      },
    },
    {
      name: "/설정 출석보상",
      args: "금액",
      description: "[관리자] 출석 보상 금액 변경",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        const amount = Number(args[0]);
        if (!Number.isFinite(amount) || amount <= 0) return errorEmbed("사용법: /설정 출석보상 금액");
        const s = S.get();
        s.attendance.reward = amount;
        S.notify();
        return embed("admin", "🛠 설정 변경", [`출석 보상을 ${S.formatEva(amount)}로 바꿨어요.`]);
      },
    },
    {
      name: "/테스트 마리상태",
      description: "[관리자] AI 호출 한도 확인",
      adminOnly: true,
      run(args, ctx) {
        const blocked = needAdmin(ctx.admin);
        if (blocked) return blocked;
        return embed("admin", "🛠 마리 상태", ["분당 호출: 3/8 (RPM)", "오늘 호출: 41/200 (RPD)"]);
      },
    },
  ];

  const CHANNELS = [
    {
      id: "chat",
      name: "마리-대화",
      type: "chat",
      intro: "마리를 멘션하듯 자유롭게 말을 걸어보세요. (자유 잡담 전용, 슬래시 명령어는 다른 채널에서!)",
    },
    { id: "wallet", name: "지갑-경제", type: "commands", commands: walletCommands, intro: "지갑, 송금, 출석, 캠프 세금을 체험할 수 있어요." },
    { id: "stock", name: "주식", type: "commands", commands: stockCommands, intro: "시세는 4초마다 자동으로 움직여요. /주식 목록으로 먼저 확인해보세요." },
    { id: "shop", name: "상점", type: "commands", commands: shopCommands, intro: "/상점 목록으로 매대를 확인하고 구매/되팔기를 해보세요." },
    { id: "lottery", name: "복권", type: "commands", commands: lotteryCommands, intro: "복권을 사고 /복권 당첨확인으로 바로 추첨 결과를 볼 수 있어요." },
    { id: "minigame", name: "미니게임", type: "commands", commands: minigameCommands, intro: "/하이로우로 판을 연 다음 /하이 또는 /로우로 맞혀보세요." },
    { id: "profile", name: "프로필-위키", type: "commands", commands: profileCommands, intro: "프로필, 위키, 생일, 아이디 조회를 체험할 수 있어요." },
    {
      id: "admin",
      name: "관리자-전용",
      type: "commands",
      commands: adminCommands,
      adminOnly: true,
      intro: "관리자 모드에서만 보이는 채널이에요. 기능을 정지하면 다른 채널에 바로 반영돼요.",
    },
  ];

  function allCommandsFor(channel, isAdmin) {
    if (!channel.commands) return [];
    return channel.commands.filter((c) => isAdmin || !c.adminOnly);
  }

  function parse(input, channel) {
    const trimmed = input.trim();
    const candidates = channel.commands
      .slice()
      .sort((a, b) => b.name.length - a.name.length);

    for (const cmd of candidates) {
      if (trimmed === cmd.name || trimmed.startsWith(cmd.name + " ")) {
        const rest = trimmed.slice(cmd.name.length).trim();
        const args = rest.length ? rest.split(/\s+/) : [];
        return { cmd, args };
      }
    }
    return null;
  }

  function execute(input, channel, isAdmin) {
    const parsed = parse(input, channel);
    if (!parsed) {
      const names = channel.commands.map((c) => c.name).join(", ");
      return errorEmbed(`이 채널에서는 그 명령어를 못 써. 사용 가능한 명령어: ${names}`);
    }
    if (parsed.cmd.adminOnly && !isAdmin) {
      return errorEmbed("이 명령어는 관리자 전용이야. 우측 상단 토글을 켜고 다시 시도해줘.");
    }
    return parsed.cmd.run(parsed.args, { admin: isAdmin });
  }

  return { CHANNELS, allCommandsFor, execute };
})();
